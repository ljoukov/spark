export type SparkChatForcedTool = 'create_sheet' | 'create_grader';

export const AMBIGUOUS_ATTACHMENT_CLARIFYING_QUESTION =
	'What would you like me to do with this upload? I can turn it into a worksheet to solve, grade completed answers, or build a lesson from it.';

function normalizeTurnText(text: string | undefined): string {
	return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const worksheetVerbPattern =
	/\b(create|make|turn|convert|build|generate|prepare|produce|draft|set up)\b[\s\S]{0,100}\b(student|learner|class|pupil)?[\s\S]{0,20}\b(worksheet|sheet|question sheet|practice sheet|exam sheet)\b/;
const worksheetSolvePattern =
	/\b(worksheet|sheet|questions?|practice)\b[\s\S]{0,80}\b(to solve|to answer|to practise|to practice|to work on|for (me|us|students?) to solve|for (me|us|students?) to answer|for (me|us|students?) to work on)\b/;
const worksheetFromUploadPattern =
	/\b(worksheet|sheet|question sheet|practice sheet|exam sheet)\b[\s\S]{0,100}\b(from|using|based on)\b[\s\S]{0,60}\b(attached|uploaded|upload|pdf|document|material|file)\b/;
const worksheetAttachmentRequestPattern =
	/\b(attached|uploaded|upload|pdf|document|material|file)\b[\s\S]{0,80}\b(create|make|turn|convert|build|generate|prepare|produce|draft)\b[\s\S]{0,80}\b(worksheet|sheet|question sheet|practice sheet|exam sheet)\b/;
const worksheetQuestionGenerationPattern =
	/\b(create|make|turn|convert|build|generate|prepare|produce|draft|set up)\b[\s\S]{0,80}\b(questions?|problems?|practice paper)\b[\s\S]{0,100}\b(from|using|based on|out of)?\b[\s\S]{0,60}\b(attached|uploaded|upload|pdf|document|material|file|paper|this|that)\b/;
const worksheetSolveableConversionPattern =
	/\b(turn|convert|make|create|build|generate|prepare|produce)\b[\s\S]{0,100}\b(attached|uploaded|upload|pdf|document|material|file|paper|this|that)\b[\s\S]{0,60}\b(into|to)\b[\s\S]{0,60}\b(something (i|we|students?) can solve|practice questions?|questions? to solve|problems? to solve|practice paper|worksheet)\b/;
const worksheetReuseUploadPattern =
	/\buse\b[\s\S]{0,40}\b(this|that|the)?\b[\s\S]{0,40}\b(attached|uploaded|upload|pdf|document|material|file|paper)\b[\s\S]{0,60}\b(as|for)\b[\s\S]{0,40}\b(a )?(worksheet|sheet|practice paper|question sheet)\b/;
const modelAnswerRequestPattern =
	/\b(?:model|modal|sample|exemplar|full[-\s]?marks?|mark[-\s]?scheme[-\s]?based)\s+answers?\b|\banswer\s+key\b|\bworked\s+solutions?\b/;
const graderVerbPattern = /\b(grade|remark|assess|check)\b|\bmark\b(?!\s+schemes?\b)/;
const graderObjectPattern =
	/\b(work|worksheet|sheet|submission|answer|answers|solution|solutions|paper|script|attempt|attempts)\b/;

export function resolveForcedSparkChatToolForTurn(options: {
	text?: string;
	hasAttachmentContext: boolean;
}): SparkChatForcedTool | null {
	if (!options.hasAttachmentContext) {
		return null;
	}
	const normalized = normalizeTurnText(options.text);
	if (normalized.length === 0) {
		return null;
	}
	if (modelAnswerRequestPattern.test(normalized)) {
		return null;
	}
	if (graderVerbPattern.test(normalized) && graderObjectPattern.test(normalized)) {
		return 'create_grader';
	}
	if (
		worksheetVerbPattern.test(normalized) ||
		worksheetSolvePattern.test(normalized) ||
		worksheetFromUploadPattern.test(normalized) ||
		worksheetAttachmentRequestPattern.test(normalized) ||
		worksheetQuestionGenerationPattern.test(normalized) ||
		worksheetSolveableConversionPattern.test(normalized) ||
		worksheetReuseUploadPattern.test(normalized)
	) {
		return 'create_sheet';
	}
	return null;
}

export function shouldAskClarifyingQuestionForAttachmentTurn(options: {
	text?: string;
	currentMessageHasAttachments: boolean;
}): boolean {
	if (!options.currentMessageHasAttachments) {
		return false;
	}
	const normalized = normalizeTurnText(options.text);
	return normalized.length === 0;
}

export function buildForcedSparkChatToolInstruction(
	requiredTool: SparkChatForcedTool
): string {
	switch (requiredTool) {
		case 'create_sheet':
			return [
				'Immediate routing rule for this user turn:',
				'- The learner is explicitly asking Spark to make a worksheet from uploaded material.',
				'- This is a hard constraint, not a preference.',
				'- You MUST call `create_sheet` before any user-facing answer.',
				'- If the uploaded material is already a printed worksheet or exam page, treat it as canonical source content and preserve the original wording/structure rather than redesigning it.',
				'- Do not emit an acknowledgement-only reply such as "I am creating a worksheet" unless the tool was already called in the same response.',
				'- Do not answer with worksheet content directly in chat.',
				'- After `create_sheet` returns `status="started"`, briefly say the sheet is being prepared in the background.'
			].join('\n');
		case 'create_grader':
			return [
				'Immediate routing rule for this user turn:',
				'- The learner is explicitly asking Spark to grade uploaded work.',
				'- This is a hard constraint, not a preference.',
				'- You MUST call `create_grader` before any user-facing answer.',
				'- Do not emit an acknowledgement-only reply such as "I am grading it now" unless the tool was already called in the same response.',
				'- Do not answer with grading feedback directly in chat.',
				'- After `create_grader` returns `status="started"`, briefly say grading is running in the background.'
			].join('\n');
	}
}

export function buildForcedSparkChatStartedReply(requiredTool: SparkChatForcedTool): string {
	switch (requiredTool) {
		case 'create_sheet':
			return 'I’m creating a worksheet from the uploaded material. It will appear under `/spark/sheets` when it is ready.';
		case 'create_grader':
			return 'I’m grading the uploaded work now. The live sheet card above will update as the grading run progresses.';
	}
}
