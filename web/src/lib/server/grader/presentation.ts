type GraderRunPaperInput = {
	contextLabel?: string | null;
	year?: string | null;
	paperName?: string | null;
};

type GraderRunPresentationInput = {
	title?: string | null;
	subtitle?: string | null;
	summaryMarkdown?: string | null;
	footer?: string | null;
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
	subtitle: string | null;
	metaLine: string | null;
	summaryMarkdown: string | null;
	footer: string | null;
};

const PLACEHOLDER_TEXT_PATTERN =
	/^(unknown\b|unidentified\b|year pending\b|paper pending\b|not specified\b)/i;
const MACHINE_SUMMARY_PATTERN =
	/(completed grader run\b|grader\/output\/|run-summary\.json\b|transcription-first\b|workspace(?:id)?\b|uploaded-only\b|line-by-line annotation\b|tool names?\b|run ids?\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const USER_VISIBLE_PROCESS_PATTERN =
	/\b(?:question\s+paper\s+transcription|transcription|transcribed|ocr|extracted\s+text|source\s+transcript|worksheet\s+json|artifact|publish(?:ed)?\s+sheet)\b/i;
const SESSION_LABEL_PATTERN =
	/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/i;

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

function getStudentFacingText(value: string | null | undefined): string | null {
	const meaningful = getMeaningfulText(value);
	if (!meaningful || USER_VISIBLE_PROCESS_PATTERN.test(meaningful)) {
		return null;
	}
	return meaningful;
}

function extractSessionLabel(value: string | null | undefined): string | null {
	const meaningful = getMeaningfulText(value);
	if (!meaningful) {
		return null;
	}
	const match = SESSION_LABEL_PATTERN.exec(meaningful);
	return match?.[0] ?? meaningful;
}

function pushDistinct(parts: string[], value: string | null): void {
	if (!value) {
		return;
	}
	const normalized = value.toLowerCase();
	if (!parts.some((part) => part.toLowerCase() === normalized)) {
		parts.push(value);
	}
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

function buildFallbackSubtitle(options: {
	status: GraderRunDisplayInput['status'];
	sheetPhase?: GraderRunDisplayInput['sheetPhase'];
	metaLine: string | null;
}): string | null {
	if (options.metaLine) {
		return options.metaLine;
	}
	if (options.sheetPhase === 'building') {
		return options.status === 'created'
			? 'Queued from the uploaded material.'
			: 'Preparing a worksheet from the uploaded material.';
	}
	if (options.sheetPhase === 'solving') {
		return 'Worksheet draft prepared from the uploaded material.';
	}
	if (options.sheetPhase === 'grading') {
		return options.status === 'created'
			? 'Saved answers are queued for grading.'
			: 'Submitted answers are being graded.';
	}
	if (options.sheetPhase === 'graded' || options.status === 'done') {
		return 'Worksheet review prepared from the uploaded material.';
	}
	if (options.status === 'created') {
		return 'Queued from the uploaded material.';
	}
	if (options.status === 'executing') {
		return 'Submitted answers are being graded.';
	}
	if (options.status === 'stopped') {
		return 'Worksheet processing stopped before completion.';
	}
	if (options.status === 'failed') {
		return 'Worksheet processing could not be completed.';
	}
	return 'Uploaded material.';
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

function buildFooter(options: {
	presentation?: GraderRunPresentationInput | null;
	paper?: GraderRunPaperInput | null;
}): string | null {
	const explicitFooter = getStudentFacingText(options.presentation?.footer);
	if (explicitFooter) {
		return explicitFooter;
	}
	const parts: string[] = [];
	pushDistinct(parts, getMeaningfulText(options.paper?.contextLabel));
	pushDistinct(parts, getMeaningfulText(options.paper?.paperName));
	if (parts.length === 0) {
		pushDistinct(parts, getStudentFacingText(options.presentation?.title));
	}
	pushDistinct(
		parts,
		extractSessionLabel(options.paper?.year) ?? extractSessionLabel(options.presentation?.subtitle)
	);
	if (parts.length === 0) {
		return 'Uploaded material';
	}
	return parts.join(' · ');
}

export function buildGraderRunDisplay(input: GraderRunDisplayInput): GraderRunDisplay {
	const paperName = getMeaningfulText(input.paper?.paperName);
	const title =
		getMeaningfulText(input.presentation?.title) ??
		buildFallbackTitle({ paperName });
	const metaLine = buildMetaLine({
		title,
		paper: input.paper
	});
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
		subtitle:
			getMeaningfulText(input.presentation?.subtitle) ??
			buildFallbackSubtitle({
				status: input.status,
				sheetPhase: input.sheetPhase,
				metaLine
			}),
		metaLine,
		summaryMarkdown,
		footer: buildFooter({
			presentation: input.presentation,
			paper: input.paper
		})
	};
}
