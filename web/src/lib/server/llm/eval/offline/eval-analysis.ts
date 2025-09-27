import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JudgeFilePayloadSchema, type JudgeFilePayload } from './payload';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(CURRENT_DIR, '../../../../../../');
const REPO_ROOT = path.resolve(WEB_ROOT, '../');
const OUTPUT_DIR = path.join(REPO_ROOT, 'spark-data', 'output');
const FULL_SCORE_EPSILON = 1e-6;

type LoadedJudgeFile = {
	readonly payload: JudgeFilePayload;
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly evaluationType: 'quiz' | 'extension';
};

function isFullScore(score: number): boolean {
	return Math.abs(score - 1) <= FULL_SCORE_EPSILON;
}

async function loadJudgeFiles(): Promise<LoadedJudgeFile[]> {
	if (!existsSync(OUTPUT_DIR)) {
		console.warn(`[analysis] WARN output directory not found at ${OUTPUT_DIR}`);
		return [];
	}
	const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
	const results: LoadedJudgeFile[] = [];
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
				results.push({
					payload: parsed,
					absolutePath: filePath,
					relativePath: path.relative(OUTPUT_DIR, filePath).split(path.sep).join('/'),
					evaluationType: fileEntry.name.includes('extension') ? 'extension' : 'quiz'
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

function summariseJudgements(judgements: LoadedJudgeFile[]): void {
	if (judgements.length === 0) {
		console.log('[analysis] No judgement files found.');
		return;
	}

	let issueCount = 0;
	let nonFullScoreCount = 0;
	const nonFullScoreBuckets = new Map<string, number>();

	for (const judgement of judgements) {
		const verdict = judgement.payload.judge.verdict.verdict;
		if (verdict !== 'approve') {
			issueCount += 1;
		}
		for (const finding of judgement.payload.judge.verdict.rubricFindings) {
			if (isFullScore(finding.score)) {
				continue;
			}
			nonFullScoreCount += 1;
			const roundedScore = Math.floor(finding.score * 10) / 10;
			const bucket = roundedScore.toFixed(1);
			nonFullScoreBuckets.set(bucket, (nonFullScoreBuckets.get(bucket) ?? 0) + 1);
		}
	}

	const total = judgements.length;
	const issuePercentage = total === 0 ? 0 : (issueCount / total) * 100;
	console.log(`[analysis] Processed ${total} judgement file${total === 1 ? '' : 's'}.`);
	console.log(
		`[analysis] Quizzes with issues: ${issueCount} (${formatPercentage(issuePercentage)}).`
	);
	console.log('[analysis] Non-1.0 rubric scores (rounded to 0.1 increments):');
	if (nonFullScoreCount === 0) {
		console.log('  - None');
		return;
	}

	const distribution: ScoreDistributionEntry[] = Array.from(nonFullScoreBuckets.entries())
		.map(([bucket, count]) => ({
			bucket,
			count,
			percentage: (count / nonFullScoreCount) * 100
		}))
		.sort((a, b) => Number.parseFloat(b.bucket) - Number.parseFloat(a.bucket));

	for (const entry of distribution) {
		console.log(
			`  - ${entry.bucket}: ${formatPercentage(entry.percentage)} (${entry.count}/${nonFullScoreCount})`
		);
	}
}

async function main(): Promise<void> {
	const judgements = await loadJudgeFiles();
	summariseJudgements(judgements);
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[analysis] ERROR ${message}`);
	process.exitCode = 1;
});
