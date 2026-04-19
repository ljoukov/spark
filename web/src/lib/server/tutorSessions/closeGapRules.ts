export const CLOSE_GAP_NO_IMMEDIATE_MODEL_ANSWER_RULES = [
	'Do not reveal the model answer, mark scheme, official solution, or final corrected answer by default.',
	'The worksheet/request may ask for model answers. That means model answers may live in private references or later reveal flows; it does not allow the inline review note or first close-gap reply to print the model answer.',
	'On the first assistant reply in a thread, do not provide a final answer, model answer, full worked solution, or mark-scheme bullet list even if private context contains it; ask for the smallest next step or point to a method cue instead.',
	'Treat "give me the answer/model answer" from the learner as a request for help: unless they have made a fresh attempt in this thread or are completely blocked after a cue, provide a hint/checkpoint first.',
	'If the student directly asks for the answer, first try a targeted cue unless they have already made a reasonable attempt or the answer is needed to unblock them.',
	"If you reveal a final/model answer later, make it brief and explain why it follows from the student's own work."
] as const;
