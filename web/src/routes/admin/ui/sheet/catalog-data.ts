export type SheetCatalogCategoryId = 'structure' | 'inputs' | 'outputs' | 'runtime' | 'adjacent';

export type SheetCatalogPreviewKind =
	| 'sheet-root'
	| 'sheet-header'
	| 'hook'
	| 'content-section'
	| 'theory'
	| 'info-box'
	| 'footer'
	| 'answer-bank'
	| 'fill'
	| 'group'
	| 'mcq'
	| 'lines'
	| 'calc'
	| 'match'
	| 'spelling'
	| 'review-summary'
	| 'question-feedback'
	| 'attachment-output'
	| 'runtime-feedback'
	| 'annotated-text';

export type SheetCatalogCategory = {
	id: SheetCatalogCategoryId;
	label: string;
	title: string;
	description: string;
};

export type SheetCatalogItem = {
	id: string;
	categoryId: SheetCatalogCategoryId;
	component:
		| 'Sheet'
		| 'SheetFeedbackCard'
		| 'SheetFeedbackThread'
		| 'AnnotatedTextPanel';
	kindLabel: string;
	title: string;
	description: string;
	requiredInputs: string[];
	optionalInputs?: string[];
	answerShape?: string;
	note?: string;
	previewKind: SheetCatalogPreviewKind;
};

export const sheetCatalogCategories: SheetCatalogCategory[] = [
	{
		id: 'structure',
		label: 'Structure',
		title: 'Sheet frame and section blocks',
		description:
			'The container, identity header, and repeatable section scaffolding that define a sheet.'
	},
	{
		id: 'inputs',
		label: 'Inputs',
		title: 'Supported problem input types',
		description:
			'Every question variant and grouped multipart block currently modeled in the shared sheet schema.'
	},
	{
		id: 'outputs',
		label: 'Outputs',
		title: 'Review and answer output surfaces',
		description: 'What the sheet can render back once answers, grading, and discussion data exist.'
	},
	{
		id: 'runtime',
		label: 'Runtime',
		title: 'Live feedback progression',
		description:
			'Streaming and resolved feedback states used while the tutor conversation is active.'
	},
	{
		id: 'adjacent',
		label: 'Adjacent',
		title: 'Sheet-adjacent display surfaces',
		description:
			'Related teaching surfaces that sit alongside the worksheet flow but use their own shape.'
	}
] as const;

export const sheetCatalogItems: SheetCatalogItem[] = [
	{
		id: 'sheet-root',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Container',
		title: 'Sheet root',
		description:
			'Top-level worksheet surface that owns theme tokens, numbering, section state, answer state, and optional review/feedback overlays.',
		requiredInputs: [
			'document.id',
			'document.subject',
			'document.level',
			'document.title',
			'document.subtitle',
			'document.color',
			'document.accent',
			'document.light',
			'document.border',
			'document.sections[]'
		],
		optionalInputs: [
			'answers',
			'seedAnswers',
			'review',
			'mockReview',
			'feedbackThreads',
			'feedbackState',
			'mode',
			'gradeLabel',
			'grading',
			'allowReplies',
			'showFooter',
			'onAnswersChange',
			'onGrade',
			'onReply'
		],
		previewKind: 'sheet-root'
	},
	{
		id: 'sheet-header',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Header',
		title: 'Sheet header and identity',
		description:
			'The opening identity block for subject, level, title, subtitle, and theme-driven accent treatment.',
		requiredInputs: [
			'document.subject',
			'document.level',
			'document.title',
			'document.subtitle',
			'document.color',
			'document.accent',
			'document.light',
			'document.border'
		],
		optionalInputs: ['document.sections[] (used to derive total marks)'],
		previewKind: 'sheet-header'
	},
	{
		id: 'hook-section',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Section type',
		title: 'Hook section',
		description:
			'Introductory reading block that sits under the header and frames the worksheet before question sections begin.',
		requiredInputs: ['section.type = "hook"', 'section.text'],
		previewKind: 'hook'
	},
	{
		id: 'content-section',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Section type',
		title: 'Content section shell',
		description:
			'Collapsible section scaffold with label, derived mark total, optional theory, optional info box, and question or multipart-group list.',
		requiredInputs: ['section.id', 'section.label'],
		optionalInputs: ['section.theory', 'section.infoBox', 'section.questions[]'],
		previewKind: 'content-section'
	},
	{
		id: 'theory-block',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Section block',
		title: 'Theory block',
		description:
			'Markdown-rich teaching copy that appears inside a content section before the questions.',
		requiredInputs: ['section.theory'],
		previewKind: 'theory'
	},
	{
		id: 'info-box',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Section block',
		title: 'Info box',
		description:
			'Callout for fast facts, equations, or worked examples that need more emphasis than the main theory block.',
		requiredInputs: ['section.infoBox.icon', 'section.infoBox.title', 'section.infoBox.text'],
		previewKind: 'info-box'
	},
	{
		id: 'sheet-footer',
		categoryId: 'structure',
		component: 'Sheet',
		kindLabel: 'Footer',
		title: 'Sheet footer',
		description:
			'Closing identity stripe used at the bottom of the sheet when footer rendering is enabled.',
		requiredInputs: ['document.level', 'document.subject', 'document.title'],
		optionalInputs: ['showFooter = true'],
		previewKind: 'footer'
	},
	{
		id: 'group-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Grouped multipart question',
		description:
			'Shared numbered stem for a source question that carries common text, a table, or a diagram before answer-bearing subparts such as 10(a) and 10(b).',
		requiredInputs: [
			'entry.id',
			'entry.type = "group"',
			'entry.displayNumber',
			'entry.prompt',
			'entry.questions[]'
		],
		note: 'Use this when the source prints one numbered question with shared context and multiple subparts. Keep source-faithful labels in `displayNumber`, and provide `badgeLabel` for compact subpart circles when needed. Do not hoist shared context into section theory.',
		previewKind: 'group'
	},
	{
		id: 'answer-bank-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Answer bank blanks',
		description:
			'Inline sentence blanks filled from a constrained answer bank, for source-faithful worksheet questions that print a fixed list of options beneath the stem.',
		requiredInputs: [
			'question.id',
			'question.type = "answer_bank"',
			'question.marks',
			'question.displayMode',
			'question.segments[]',
			'question.blanks[]',
			'question.options[]'
		],
		optionalInputs: ['question.allowReuse', 'option.label', 'blank.placeholder', 'blank.minWidth'],
		answerShape: 'answers[question.id] = Record<blankIndex, optionId>',
		note: 'Use this when the source shows visible blanks plus a fixed answer bank such as (A)–(D). Keep the sentence in `segments[]`, keep source option labels in `options[].label`, store the selection by stable `option.id`, and omit decorative blank brackets like `(____)` from the prose. Use `displayMode = "inline_labeled"` when the full labelled option should appear inside each selector, and `displayMode = "banked"` when the source uses a separate visible answer bank.',
		previewKind: 'answer-bank'
	},
	{
		id: 'fill-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Fill in the blanks',
		description:
			'Inline sentence completion with one or two blank fields, useful for short factual recall and keyword retrieval.',
		requiredInputs: [
			'question.id',
			'question.type = "fill"',
			'question.marks',
			'question.prompt',
			'question.blanks[]',
			'question.after'
		],
		optionalInputs: ['question.conjunction', 'blank.placeholder', 'blank.minWidth'],
		answerShape: 'answers[question.id] = Record<"0" | "1", string>',
		previewKind: 'fill'
	},
	{
		id: 'mcq-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Multiple choice',
		description: 'Button-based single-select question with two or more markdown-capable options.',
		requiredInputs: [
			'question.id',
			'question.type = "mcq"',
			'question.marks',
			'question.displayMode',
			'question.prompt',
			'question.options[]'
		],
		answerShape: 'answers[question.id] = optionId',
		note: 'Use `displayMode = "full_options"` when each option should render as the selectable card itself. Use `displayMode = "labels_only"` when long source options should stay listed separately above compact selectors. Schema minimum is two options.',
		previewKind: 'mcq'
	},
	{
		id: 'lines-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Lines / extended response',
		description:
			'Freeform textarea response for explanations, justifications, and longer written answers.',
		requiredInputs: [
			'question.id',
			'question.type = "lines"',
			'question.marks',
			'question.prompt',
			'question.lines'
		],
		optionalInputs: ['question.renderMode'],
		answerShape: 'answers[question.id] = string',
		note: '`renderMode = "markdown"` switches locked output to rendered markdown instead of a textarea.',
		previewKind: 'lines'
	},
	{
		id: 'calc-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Calculation row',
		description: 'Compact numeric or symbolic answer row with a left label and a right-side unit.',
		requiredInputs: [
			'question.id',
			'question.type = "calc"',
			'question.marks',
			'question.prompt',
			'question.inputLabel',
			'question.unit'
		],
		optionalInputs: ['question.hint'],
		answerShape: 'answers[question.id] = string',
		previewKind: 'calc'
	},
	{
		id: 'match-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Match pairs',
		description:
			'Two-column matching interaction where the student selects a term, then assigns its paired meaning.',
		requiredInputs: [
			'question.id',
			'question.type = "match"',
			'question.marks',
			'question.prompt',
			'question.pairs[]'
		],
		answerShape: 'answers[question.id] = Record<string, string>',
		note: 'Each pair requires both `term` and `match`.',
		previewKind: 'match'
	},
	{
		id: 'spelling-question',
		categoryId: 'inputs',
		component: 'Sheet',
		kindLabel: 'Question type',
		title: 'Spelling correction',
		description:
			'Correction list that presents a misspelled word and captures the repaired spelling inline.',
		requiredInputs: [
			'question.id',
			'question.type = "spelling"',
			'question.marks',
			'question.prompt',
			'question.words[]'
		],
		answerShape: 'answers[question.id] = Record<string, string>',
		note: 'Each entry in `words[]` currently requires `wrong`.',
		previewKind: 'spelling'
	},
	{
		id: 'review-summary',
		categoryId: 'outputs',
		component: 'Sheet',
		kindLabel: 'Output',
		title: 'Sheet review summary',
		description:
			'Top-level review banner that communicates score, grading note, and whether some marks stay in teacher-review.',
		requiredInputs: [
			'review.score.got',
			'review.score.total',
			'review.label',
			'review.message',
			'review.note',
			'review.questions'
		],
		optionalInputs: [
			'review.objectiveQuestionCount',
			'review.teacherReviewMarks',
			'review.teacherReviewQuestionCount'
		],
		previewKind: 'review-summary'
	},
	{
		id: 'question-feedback',
		categoryId: 'outputs',
		component: 'SheetFeedbackCard',
		kindLabel: 'Output',
		title: 'Question feedback note',
		description:
			'Per-question feedback surface that wraps a review note, optional conversation thread, and reply composer.',
		requiredInputs: [
			'review.status',
			'review.note',
			'questionLabel',
			'draft',
			'onToggle',
			'onDraftChange',
			'onReply'
		],
		optionalInputs: [
			'review.label',
			'review.statusLabel',
			'review.replyPlaceholder',
			'review.followUp',
			'thread',
			'showComposer',
			'showFollowUpButton',
			'resolvedFollowUpMode',
			'draftAttachments',
			'draftAttachmentError',
			'allowAttachments',
			'allowTakePhoto',
			'processing',
			'runtimeStatus',
			'thinkingText',
			'assistantDraftText'
		],
		previewKind: 'question-feedback'
	},
	{
		id: 'attachment-output',
		categoryId: 'outputs',
		component: 'SheetFeedbackThread',
		kindLabel: 'Output',
		title: 'Feedback attachments',
		description:
			'Student or tutor turns can include images and files, both in persisted threads and in draft composer state.',
		requiredInputs: [
			'turn.id',
			'turn.speaker',
			'turn.text or turn.attachments[]',
			'attachment.id',
			'attachment.filename',
			'attachment.contentType',
			'attachment.sizeBytes'
		],
		optionalInputs: ['attachment.url', 'attachment.filePath'],
		previewKind: 'attachment-output'
	},
	{
		id: 'runtime-feedback',
		categoryId: 'runtime',
		component: 'SheetFeedbackCard',
		kindLabel: 'Runtime state',
		title: 'Feedback progression states',
		description:
			'The tutor feedback card can represent pending, thinking, responding, and resolved states while the conversation progresses.',
		requiredInputs: ['review', 'questionLabel', 'draft', 'onToggle', 'onDraftChange', 'onReply'],
		optionalInputs: [
			'thread.status',
			'thread.turns[]',
			'processing',
			'runtimeStatus',
			'thinkingText',
			'assistantDraftText',
			'showComposer',
			'showFollowUpButton'
		],
		previewKind: 'runtime-feedback'
	},
	{
		id: 'annotated-text',
		categoryId: 'adjacent',
		component: 'AnnotatedTextPanel',
		kindLabel: 'Adjacent surface',
		title: 'Annotated text panel',
		description:
			'Standalone text review surface for passage-level annotations, highlight metadata, and theme-aware teaching comments.',
		requiredInputs: [
			'document.heading',
			'document.description',
			'document.text',
			'document.annotations[]',
			'document.annotationTypes'
		],
		optionalInputs: ['theme'],
		note: 'Each annotation needs `id`, `start`, `end`, `type`, `label`, and `comment`.',
		previewKind: 'annotated-text'
	}
] as const;
