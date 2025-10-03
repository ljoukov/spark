export type CodeProgressStepKey =
        | 'warmup'
        | 'topic'
        | 'problem-one'
        | 'problem-two'
        | 'review';

export type CodeProgressState = Record<CodeProgressStepKey, boolean>;
