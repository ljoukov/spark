type GraderRunPaperInput = {
	contextLabel?: string | null;
	year?: string | null;
	paperName?: string | null;
};

type GraderRunPresentationInput = {
	title?: string | null;
	summaryMarkdown?: string | null;
};

type GraderRunTotalsInput = {
	problemCount?: number | null;
	gradedCount?: number | null;
};

type GraderRunProblemInput = {
	index?: number | null;
};

type GraderRunDisplayInput = {
	status: 'created' | 'executing' | 'stopped' | 'failed' | 'done';
	paper?: GraderRunPaperInput | null;
	presentation?: GraderRunPresentationInput | null;
	totals?: GraderRunTotalsInput | null;
	problems?: GraderRunProblemInput[] | null;
	resultSummary?: string | null;
};

export type GraderRunDisplay = {
	title: string;
	metaLine: string | null;
	summaryMarkdown: string | null;
};

const PLACEHOLDER_TEXT_PATTERN =
	/^(unknown\b|unidentified\b|year pending\b|paper pending\b|not specified\b)/i;
const MACHINE_SUMMARY_PATTERN =
	/(completed grader run\b|grader\/output\/|run-summary\.json\b|transcription-first\b|workspace(?:id)?\b|uploaded-only\b|line-by-line annotation\b|tool names?\b|run ids?\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function getMeaningfulText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	if (PLACEHOLDER_TEXT_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed;
}

function getProblemIndices(problems: GraderRunProblemInput[] | null | undefined): number[] {
	const indices = new Set<number>();
	for (const problem of problems ?? []) {
		if (typeof problem.index === 'number' && Number.isInteger(problem.index) && problem.index > 0) {
			indices.add(problem.index);
		}
	}
	return [...indices].sort((left, right) => left - right);
}

function isContiguous(indices: number[]): boolean {
	if (indices.length < 2) {
		return true;
	}
	for (let index = 1; index < indices.length; index += 1) {
		const previous = indices[index - 1];
		const current = indices[index];
		if (previous === undefined || current === undefined || current !== previous + 1) {
			return false;
		}
	}
	return true;
}

function formatNumberList(values: number[]): string {
	if (values.length === 0) {
		return '';
	}
	if (values.length === 1) {
		return values[0]?.toString() ?? '';
	}
	if (values.length === 2) {
		const [first, second] = values;
		return `${first?.toString() ?? ''} and ${second?.toString() ?? ''}`;
	}
	const allButLast = values
		.slice(0, -1)
		.map((value) => value.toString())
		.join(', ');
	const last = values[values.length - 1];
	return `${allButLast}, and ${last?.toString() ?? ''}`;
}

function buildFallbackTitle(options: {
	paperName: string | null;
	problemCount: number;
	indices: number[];
}): string {
	if (options.paperName) {
		return options.paperName;
	}
	if (options.indices.length === 1) {
		return `Problem ${options.indices[0]?.toString() ?? '1'} submission`;
	}
	if (options.indices.length > 1 && options.indices.length <= 4) {
		return `Problems ${formatNumberList(options.indices)} submission`;
	}
	if (options.indices.length > 1 && isContiguous(options.indices)) {
		const first = options.indices[0];
		const last = options.indices[options.indices.length - 1];
		return `Problems ${first?.toString() ?? '1'}-${last?.toString() ?? options.indices.length.toString()} submission`;
	}
	if (options.problemCount === 1) {
		return 'Single-problem submission';
	}
	if (options.problemCount > 1) {
		return `${options.problemCount.toString()}-problem submission`;
	}
	return 'Uploaded submission';
}

function buildMetaLine(options: {
	title: string;
	paper?: GraderRunPaperInput | null;
}): string | null {
	const year = getMeaningfulText(options.paper?.year);
	const contextLabel = getMeaningfulText(options.paper?.contextLabel);
	const parts = [year, contextLabel].filter((value): value is string => value !== null);
	if (parts.length === 0) {
		return null;
	}
	const titleLower = options.title.toLowerCase();
	if (parts.every((part) => titleLower.includes(part.toLowerCase()))) {
		return null;
	}
	return parts.join(' • ');
}

function buildScopeSentence(problemCount: number, indices: number[]): string {
	if (indices.length === 1) {
		return `This run covers Problem ${indices[0]?.toString() ?? '1'} only.`;
	}
	if (indices.length > 1 && indices.length <= 4) {
		return `This run covers Problems ${formatNumberList(indices)} from the upload.`;
	}
	if (indices.length > 1 && isContiguous(indices)) {
		const first = indices[0];
		const last = indices[indices.length - 1];
		return `This run covers Problems ${first?.toString() ?? '1'}-${last?.toString() ?? indices.length.toString()} from the upload.`;
	}
	if (problemCount === 1) {
		return 'This run covers one uploaded problem.';
	}
	if (problemCount > 1) {
		return `This run covers ${problemCount.toString()} uploaded problems.`;
	}
	return 'This run covers the uploaded submission.';
}

function buildFallbackSummary(options: {
	status: GraderRunDisplayInput['status'];
	paper?: GraderRunPaperInput | null;
	totals?: GraderRunTotalsInput | null;
	problemCount: number;
	indices: number[];
}): string | null {
	const notes =
		options.problemCount > 0 || options.indices.length > 0
			? [buildScopeSentence(options.problemCount, options.indices)]
			: [];
	const gradedCount =
		typeof options.totals?.gradedCount === 'number' && options.totals.gradedCount >= 0
			? options.totals.gradedCount
			: null;
	if (gradedCount !== null && options.problemCount > 0 && gradedCount < options.problemCount) {
		notes.push(
			`Marks were awarded on ${gradedCount.toString()} of ${options.problemCount.toString()} problems with gradable student work.`
		);
	}
	if (
		(options.problemCount > 0 || options.indices.length > 0 || options.status === 'done') &&
		!getMeaningfulText(options.paper?.paperName) &&
		!getMeaningfulText(options.paper?.contextLabel)
	) {
		notes.push('The paper could not be confidently identified from the uploaded materials alone.');
	}
	if (notes.length === 0) {
		if (options.status === 'executing') {
			return 'Grading is in progress.';
		}
		if (options.status === 'created') {
			return 'Waiting for grading to start.';
		}
		if (options.status === 'stopped') {
			return 'The grader run was stopped.';
		}
		return null;
	}
	if (notes.length === 1) {
		return notes[0] ?? null;
	}
	return notes.map((note) => `- ${note}`).join('\n');
}

function getPreferredSummary(options: {
	presentation?: GraderRunPresentationInput | null;
	resultSummary?: string | null;
}): string | null {
	const presentationSummary = options.presentation?.summaryMarkdown?.trim();
	if (presentationSummary && !MACHINE_SUMMARY_PATTERN.test(presentationSummary)) {
		return presentationSummary;
	}
	const resultSummary = options.resultSummary?.trim();
	if (!resultSummary) {
		return null;
	}
	if (MACHINE_SUMMARY_PATTERN.test(resultSummary)) {
		return null;
	}
	return resultSummary;
}

export function buildGraderRunDisplay(input: GraderRunDisplayInput): GraderRunDisplay {
	const indices = getProblemIndices(input.problems);
	const problemCount =
		typeof input.totals?.problemCount === 'number' && input.totals.problemCount > 0
			? input.totals.problemCount
			: indices.length;
	const paperName = getMeaningfulText(input.paper?.paperName);
	const title =
		getMeaningfulText(input.presentation?.title) ??
		buildFallbackTitle({
			paperName,
			problemCount,
			indices
		});
	const summaryMarkdown =
		getPreferredSummary({
			presentation: input.presentation,
			resultSummary: input.resultSummary
		}) ??
		buildFallbackSummary({
			status: input.status,
			paper: input.paper,
			totals: input.totals,
			problemCount,
			indices
		});
	return {
		title,
		metaLine: buildMetaLine({
			title,
			paper: input.paper
		}),
		summaryMarkdown
	};
}
