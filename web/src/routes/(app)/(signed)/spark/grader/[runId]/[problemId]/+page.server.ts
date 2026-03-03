import { getGraderRun, getWorkspaceTextFile } from '$lib/server/grader/repo';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function extractSection(markdown: string, heading: string): string | null {
	const normalized = markdown.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	const headingLower = heading.trim().toLowerCase();
	let startIndex: number | null = null;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (!line?.startsWith('## ')) {
			continue;
		}
		const title = line.slice(3).trim().toLowerCase();
		if (title === headingLower) {
			startIndex = index + 1;
			break;
		}
	}
	if (startIndex === null) {
		return null;
	}

	let endIndex = lines.length;
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (line?.startsWith('## ')) {
			endIndex = index;
			break;
		}
	}

	const text = lines.slice(startIndex, endIndex).join('\n').trim();
	if (text.length === 0) {
		return null;
	}
	return text;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}
	const run = await getGraderRun(user.uid, params.runId);
	if (!run) {
		throw error(404, 'Grader run not found');
	}
	const problem = (run.problems ?? []).find((entry) => entry.id === params.problemId);
	if (!problem) {
		throw error(404, 'Problem not found');
	}
	const markdown = await getWorkspaceTextFile(user.uid, run.workspaceId, problem.filePath);
	if (!markdown) {
		throw error(404, 'Problem report file not found');
	}
	return {
		run: {
			id: run.id,
			status: run.status,
			olympiadLabel: run.olympiadLabel
		},
		problem: {
			id: problem.id,
			index: problem.index,
			title: problem.title ?? `Problem ${problem.index.toString()}`,
			awardedMarks: typeof problem.awardedMarks === 'number' ? problem.awardedMarks : null,
			maxMarks: typeof problem.maxMarks === 'number' ? problem.maxMarks : null,
			verdict: problem.verdict ?? null,
			filePath: problem.filePath
		},
		sections: {
			statement: extractSection(markdown, 'Problem statement'),
			officialStatement: extractSection(markdown, 'Official problem statement'),
			officialSolution: extractSection(markdown, 'Official solution'),
			transcript: extractSection(markdown, 'Student solution transcript'),
			grading: extractSection(markdown, 'Grading'),
			annotations: extractSection(markdown, 'Annotation and feedback'),
			overall: extractSection(markdown, 'Overall feedback'),
			raw: markdown
		}
	};
};
