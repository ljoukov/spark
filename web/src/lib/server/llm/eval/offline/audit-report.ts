import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { runGeminiCall } from '../../../utils/gemini';
import { QUIZ_EVAL_MODEL_ID } from '../judge';
import { runJobsWithConcurrency } from './concurrency';
import type { JobProgressReporter } from './concurrency';
import { JudgeFilePayloadSchema } from './payload';
import type { JudgeFilePayload } from './payload';
import { ensureOfflineEnv, OFFLINE_PATHS } from './env';

ensureOfflineEnv();

const { repoRoot: REPO_ROOT, outputDir: OUTPUT_DIR, auditReportDir: REPORT_DIR } = OFFLINE_PATHS;
const LOCAL_ENV_PATH = path.join(REPO_ROOT, '.env.local');

if (existsSync(LOCAL_ENV_PATH)) {
	loadEnv({ path: LOCAL_ENV_PATH });
}

type EvaluationType = 'quiz' | 'extension';

type FailureCase = {
	readonly id: string;
	readonly evaluationType: EvaluationType;
	readonly jobName: string;
	readonly sourceDisplayName: string;
	readonly judgeExplanation: string;
	readonly judgeFindingJustification: string;
	readonly score: number;
	readonly auditExplanation: string;
	readonly auditConfidence: string;
};

type CriterionJob = {
	readonly criterion: string;
	readonly cases: FailureCase[];
};

function isFailureCase(judgement: JudgeFilePayload): boolean {
	if (judgement.judge.verdict.verdict !== 'revise') {
		return false;
	}
	const audit = judgement.audit;
	if (!audit) {
		return false;
	}
	return audit.result.verdictAgreement === 'agree';
}

async function loadFailureCases(): Promise<Map<string, FailureCase[]>> {
	const map = new Map<string, FailureCase[]>();
	if (!existsSync(OUTPUT_DIR)) {
		console.warn(`[audit] WARN output directory not found at ${OUTPUT_DIR}`);
		return map;
	}
	const sampleDirs = await readdir(OUTPUT_DIR, { withFileTypes: true });
	for (const entry of sampleDirs) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sampleDir = path.join(OUTPUT_DIR, entry.name);
		const files = await readdir(sampleDir, { withFileTypes: true });
		for (const fileEntry of files) {
			if (!fileEntry.isFile()) {
				continue;
			}
			if (!fileEntry.name.endsWith('-judgement.json')) {
				continue;
			}
			const filePath = path.join(sampleDir, fileEntry.name);
			try {
				const raw = await readFile(filePath, 'utf8');
				const parsed = JudgeFilePayloadSchema.parse(JSON.parse(raw));
				if (!isFailureCase(parsed)) {
					continue;
				}
				const evaluationType: EvaluationType = fileEntry.name.includes('extension')
					? 'extension'
					: 'quiz';
				const audit = parsed.audit;
				if (!audit) {
					continue;
				}
				for (const finding of parsed.judge.verdict.rubricFindings) {
					if (Math.abs(finding.score - 1) <= 1e-6) {
						continue;
					}
					const failure: FailureCase = {
						id: parsed.id,
						evaluationType,
						jobName: parsed.job.displayName,
						sourceDisplayName: parsed.source.displayName,
						judgeExplanation: parsed.judge.verdict.explanation,
						judgeFindingJustification: finding.justification,
						score: finding.score,
						auditExplanation: audit.result.explanation,
						auditConfidence: audit.result.confidence
					};
					const list = map.get(finding.criterion) ?? [];
					list.push(failure);
					map.set(finding.criterion, list);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[audit] WARN unable to read ${filePath}: ${message}`);
			}
		}
	}
	return map;
}

function slugifyCriterion(criterion: string): string {
	return criterion
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'criterion';
}

function formatScore(score: number): string {
	return `${Math.round(score * 100)}%`;
}

function buildPrompt(criterion: string, cases: FailureCase[]): string {
	const sections = cases
		.map((failure) => {
			return [
				'<case>',
				`<id>${failure.id}</id>`,
				`<type>${failure.evaluationType}</type>`,
				`<job>${failure.jobName}</job>`,
				`<source>${failure.sourceDisplayName}</source>`,
				`<score>${formatScore(failure.score)}</score>`,
				`<judge_explanation>${failure.judgeExplanation}</judge_explanation>`,
				`<rubric_finding>${failure.judgeFindingJustification}</rubric_finding>`,
				`<audit_explanation>${failure.auditExplanation}</audit_explanation>`,
				`<audit_confidence>${failure.auditConfidence}</audit_confidence>`,
				'</case>'
			].join('\n');
		})
		.join('\n');
	return [
		`<task>You are Spark's curriculum QA lead. Analyse the failing cases for the rubric "${criterion}". Produce a concise Markdown report that summarises recurring issues, highlights specific examples, and recommends concrete fixes for quiz authors.</task>`,
		'<output_format>Return Markdown with sections for summary, illustrative examples, and recommended improvements that map back to the rubric dimension.</output_format>',
		'<cases>',
		sections,
		'</cases>'
	].join('\n\n');
}

async function callModel(prompt: string, progress: JobProgressReporter): Promise<string> {
	const uploadBytes = Buffer.byteLength(prompt, 'utf8');
	const handle = progress.startModelCall({ modelId: QUIZ_EVAL_MODEL_ID, uploadBytes });
	try {
		const response = await runGeminiCall((client) =>
			client.models.generateContent({
				model: QUIZ_EVAL_MODEL_ID,
				contents: [
					{
						role: 'user',
						parts: [{ text: prompt }]
					}
				],
				config: {
					responseMimeType: 'text/markdown',
					temperature: 0.35
				}
			})
		);
		const usage = response.usageMetadata;
		if (usage) {
			const promptTokens = usage.promptTokenCount ?? 0;
			const inferenceTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
			if (promptTokens > 0 || inferenceTokens > 0) {
				progress.recordModelUsage(handle, {
					promptTokensDelta: promptTokens,
					inferenceTokensDelta: inferenceTokens,
					timestamp: Date.now()
				});
			}
		}
		const text = response.text ?? '';
		progress.reportChars(text.length);
		return text;
	} finally {
		progress.finishModelCall(handle);
	}
}

async function generateReports(jobs: CriterionJob[]): Promise<string[]> {
	if (jobs.length === 0) {
		console.log('[audit] No failure cases where the auditor agreed with the judge.');
		return [];
	}
	await mkdir(REPORT_DIR, { recursive: true });
	const concurrency = Math.min(8, Math.max(1, jobs.length));
	const results = await runJobsWithConcurrency<CriterionJob, string>({
		items: jobs,
		concurrency,
		getId: (item) => slugifyCriterion(item.criterion),
		label: '[audit]',
		handler: async (job, { progress }) => {
			progress.log(
				`[audit] Generating summary for ${job.criterion} (${job.cases.length} case${job.cases.length === 1 ? '' : 's'}).`
			);
			const prompt = buildPrompt(job.criterion, job.cases);
			const text = await callModel(prompt, progress);
			if (!text.trim()) {
				throw new Error(`Empty response for criterion ${job.criterion}`);
			}
			const slug = slugifyCriterion(job.criterion);
			const filePath = path.join(REPORT_DIR, `${slug}.md`);
			const header = `# ${job.criterion}\n\n`;
			await writeFile(filePath, `${header}${text.trim()}\n`, 'utf8');
			progress.log(`[audit] Wrote ${path.relative(REPO_ROOT, filePath)}`);
			return filePath;
		}
	});
	return results;
}

async function main(): Promise<void> {
	const failures = await loadFailureCases();
	const jobs: CriterionJob[] = Array.from(failures.entries())
		.map(([criterion, cases]) => ({
			criterion,
			cases
		}))
		.sort((a, b) => a.criterion.localeCompare(b.criterion));
	const files = await generateReports(jobs);
	if (files.length > 0) {
		console.log('[audit] Completed summaries:');
		for (const file of files) {
			console.log(`  - ${path.relative(REPO_ROOT, file)}`);
		}
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[audit] ERROR ${message}`);
	process.exitCode = 1;
});
