import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	JudgeAuditFilePayloadSchema,
	JudgeFilePayloadSchema,
	type JudgeAuditFilePayload,
	type JudgeFilePayload
} from './payload';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(CURRENT_DIR, '../../../../../../');
const REPO_ROOT = path.resolve(WEB_ROOT, '../');
const OUTPUT_DIR = path.join(REPO_ROOT, 'spark-data', 'output');
const FULL_SCORE_EPSILON = 1e-6;

type LoadedEvaluation = {
	readonly judgement: JudgeFilePayload;
	readonly audit?: JudgeAuditFilePayload;
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly evaluationType: 'quiz' | 'extension';
};

function isFullScore(score: number): boolean {
	return Math.abs(score - 1) <= FULL_SCORE_EPSILON;
}

async function loadEvaluations(): Promise<LoadedEvaluation[]> {
	if (!existsSync(OUTPUT_DIR)) {
		console.warn(`[analysis] WARN output directory not found at ${OUTPUT_DIR}`);
		return [];
	}
	const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
	const results: LoadedEvaluation[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sampleDir = path.join(OUTPUT_DIR, entry.name);
		const sampleEntries = await readdir(sampleDir, { withFileTypes: true });
		for (const fileEntry of sampleEntries) {
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
				const evaluationType: 'quiz' | 'extension' = fileEntry.name.includes('extension')
					? 'extension'
					: 'quiz';
				const auditFilePath = filePath.replace(/\.json$/u, '-audit.json');
				let auditPayload: JudgeAuditFilePayload | undefined;
				if (existsSync(auditFilePath)) {
					const auditRaw = await readFile(auditFilePath, 'utf8');
					auditPayload = JudgeAuditFilePayloadSchema.parse(JSON.parse(auditRaw));
				} else if (parsed.audit?.auditedAt) {
					auditPayload = {
						id: parsed.id,
						evaluationType,
						evaluatedAt: parsed.evaluatedAt,
						auditedAt: parsed.audit.auditedAt,
						source: parsed.source,
						job: parsed.job,
						judge: parsed.judge,
						audit: {
							model: parsed.audit.model,
							result: parsed.audit.result
						}
					};
				}
				results.push({
					judgement: parsed,
					audit: auditPayload,
					absolutePath: filePath,
					relativePath: path.relative(OUTPUT_DIR, filePath).split(path.sep).join('/'),
					evaluationType
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[analysis] WARN unable to read ${filePath}: ${message}`);
			}
		}
	}
	return results;
}

type ScoreDistributionEntry = {
	readonly bucket: string;
	readonly count: number;
	readonly percentage: number;
};

function formatPercentage(value: number): string {
	return `${value.toFixed(1)}%`;
}

function summariseEvaluations(evaluations: LoadedEvaluation[]): void {
	if (evaluations.length === 0) {
		console.log('[analysis] No judgement files found.');
		return;
	}

	console.log(
		`[analysis] Processed ${evaluations.length} judgement file${evaluations.length === 1 ? '' : 's'}.`
	);

	const evaluationsWithAudit = evaluations.filter((evaluation) => Boolean(evaluation.audit));
	const missingAuditCount = evaluations.length - evaluationsWithAudit.length;
	if (evaluationsWithAudit.length === 0) {
		console.log('[analysis] No audit data available; skipping combined metrics.');
		return;
	}
	if (missingAuditCount > 0) {
		console.log(
			`[analysis] Missing audit files for ${missingAuditCount} judgement${missingAuditCount === 1 ? '' : 's'}.`
		);
	}

	const perfectEvaluations = evaluationsWithAudit.filter((evaluation) => {
		const audit = evaluation.audit;
		if (!audit) {
			return false;
		}
		return (
			evaluation.judgement.judge.verdict.verdict === 'approve' &&
			audit.audit.result.verdictAgreement === 'agree' &&
			audit.audit.result.confidence === 'high'
		);
	});
	const perfectPercentage =
		evaluationsWithAudit.length === 0
			? 0
			: (perfectEvaluations.length / evaluationsWithAudit.length) * 100;
	console.log(
		`[analysis] Perfect (approve + agree + high confidence): ${perfectEvaluations.length}/${evaluationsWithAudit.length} (${formatPercentage(perfectPercentage)}).`
	);

	const agreedEvaluations = evaluationsWithAudit.filter(
		(evaluation) => evaluation.audit?.audit.result.verdictAgreement === 'agree'
	);
	const flaggedEvaluations = evaluationsWithAudit.filter(
		(evaluation) => evaluation.audit?.audit.result.verdictAgreement !== 'agree'
	);

	printJudgementMetrics('Auditor agreed', agreedEvaluations);
	printJudgementMetrics('Auditor flagged follow-up', flaggedEvaluations);
}

function printJudgementMetrics(label: string, evaluations: LoadedEvaluation[]): void {
	const total = evaluations.length;
	console.log(
		`[analysis] ${label}: ${total} evaluation${total === 1 ? '' : 's'}.`
	);
	if (total === 0) {
		console.log('  - None');
		return;
	}

	let issueCount = 0;
	let nonFullScoreCount = 0;
	const nonFullScoreBuckets = new Map<string, number>();

	for (const evaluation of evaluations) {
		const verdict = evaluation.judgement.judge.verdict.verdict;
		if (verdict !== 'approve') {
			issueCount += 1;
		}
		for (const finding of evaluation.judgement.judge.verdict.rubricFindings) {
			if (isFullScore(finding.score)) {
				continue;
			}
			nonFullScoreCount += 1;
			const roundedScore = Math.floor(finding.score * 10) / 10;
			const bucket = roundedScore.toFixed(1);
			nonFullScoreBuckets.set(bucket, (nonFullScoreBuckets.get(bucket) ?? 0) + 1);
		}
	}

	const issuePercentage = total === 0 ? 0 : (issueCount / total) * 100;
	console.log(
		`  - Quizzes with judge issues: ${issueCount} (${formatPercentage(issuePercentage)}).`
	);

	if (nonFullScoreCount === 0) {
		console.log('  - Non-1.0 rubric scores: none');
		return;
	}
	console.log('  - Non-1.0 rubric scores (rounded to 0.1 increments):');
	const distribution: ScoreDistributionEntry[] = Array.from(nonFullScoreBuckets.entries())
		.map(([bucket, count]) => ({
			bucket,
			count,
			percentage: (count / nonFullScoreCount) * 100
		}))
		.sort((a, b) => Number.parseFloat(b.bucket) - Number.parseFloat(a.bucket));

	for (const entry of distribution) {
		console.log(
			`    - ${entry.bucket}: ${formatPercentage(entry.percentage)} (${entry.count}/${nonFullScoreCount})`
		);
	}
}

async function main(): Promise<void> {
	const evaluations = await loadEvaluations();
	summariseEvaluations(evaluations);
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[analysis] ERROR ${message}`);
	process.exitCode = 1;
});
