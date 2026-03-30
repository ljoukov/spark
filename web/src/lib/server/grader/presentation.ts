type GraderRunPaperInput = {
	contextLabel?: string | null;
	year?: string | null;
	paperName?: string | null;
};

type GraderRunPresentationInput = {
	title?: string | null;
	summaryMarkdown?: string | null;
};

type GraderRunDisplayInput = {
	status: 'created' | 'executing' | 'stopped' | 'failed' | 'done';
	sheetPhase?: 'building' | 'solving' | 'grading' | 'graded' | null;
	paper?: GraderRunPaperInput | null;
	presentation?: GraderRunPresentationInput | null;
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

function buildFallbackTitle(options: { paperName: string | null }): string {
	if (options.paperName) {
		return options.paperName;
	}
	return 'Uploaded worksheet';
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

function buildFallbackSummary(options: {
	status: GraderRunDisplayInput['status'];
	sheetPhase?: GraderRunDisplayInput['sheetPhase'];
	paper?: GraderRunPaperInput | null;
}): string | null {
	if (options.sheetPhase === 'building') {
		if (options.status === 'executing') {
			return 'This sheet is still being prepared.';
		}
		if (options.status === 'created') {
			return 'Waiting for sheet generation to start.';
		}
		if (options.status === 'stopped') {
			return 'This sheet was stopped before generation finished.';
		}
		return 'The worksheet draft could not be prepared from the uploaded material.';
	}
	if (options.sheetPhase === 'solving') {
		return 'This sheet is ready to solve.';
	}
	if (options.sheetPhase === 'grading') {
		if (options.status === 'stopped') {
			return 'This sheet was stopped before grading finished.';
		}
		return options.status === 'created'
			? 'Waiting for grading to start.'
			: 'This sheet is still being graded.';
	}
	if (options.status === 'executing') {
		return 'This sheet is still being graded.';
	}
	if (options.status === 'created') {
		return 'Waiting for grading to start.';
	}
	if (options.status === 'stopped') {
		return 'This sheet was stopped before grading finished.';
	}
	if (
		options.status === 'done' &&
		!getMeaningfulText(options.paper?.paperName) &&
		!getMeaningfulText(options.paper?.contextLabel)
	) {
		return 'The worksheet source could not be confidently identified from the uploaded materials alone.';
	}
	return null;
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
	const paperName = getMeaningfulText(input.paper?.paperName);
	const title =
		getMeaningfulText(input.presentation?.title) ??
		buildFallbackTitle({ paperName });
	const summaryMarkdown =
		getPreferredSummary({
			presentation: input.presentation,
			resultSummary: input.resultSummary
		}) ??
		buildFallbackSummary({
			status: input.status,
			sheetPhase: input.sheetPhase,
			paper: input.paper
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
