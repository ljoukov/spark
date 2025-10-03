export const PROGRESS_STORAGE_KEY = 'spark:code:progress';

export type SessionStepId =
        | 'warmup-quiz'
        | 'topic-deck'
        | 'dp-coin-change'
        | 'dp-decode-ways'
        | 'final-review-quiz';

const QUIZ_STEP_LOOKUP: Record<string, SessionStepId> = {
        'dp-warmup-basics': 'warmup-quiz',
        'dp-topic-deck': 'topic-deck',
        'dp-final-review': 'final-review-quiz'
};

const PROBLEM_STEP_LOOKUP: Record<string, SessionStepId> = {
        'coin-change-ways': 'dp-coin-change',
        'decode-ways': 'dp-decode-ways'
};

type StoredProgress = {
        completed: SessionStepId[];
};

function getStorage(): Storage | null {
        if (typeof window === 'undefined') {
                return null;
        }
        try {
                return window.localStorage;
        } catch (error) {
                console.error('Unable to access localStorage', error);
                return null;
        }
}

function parseProgress(raw: string | null): StoredProgress {
        if (!raw) {
                return { completed: [] };
        }
        try {
                const parsed = JSON.parse(raw) as StoredProgress;
                if (!Array.isArray(parsed.completed)) {
                        return { completed: [] };
                }
                const unique = Array.from(new Set(parsed.completed));
                return { completed: unique };
        } catch (error) {
                console.error('Failed to parse stored progress', error);
                return { completed: [] };
        }
}

function writeProgress(state: StoredProgress): void {
        const storage = getStorage();
        if (!storage) {
                return;
        }
        const payload: StoredProgress = {
                completed: Array.from(new Set(state.completed))
        };
        storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(payload));
}

export function readCompletedSteps(): SessionStepId[] {
        const storage = getStorage();
        if (!storage) {
                return [];
        }
        const snapshot = parseProgress(storage.getItem(PROGRESS_STORAGE_KEY));
        return snapshot.completed;
}

export function markStepComplete(stepId: SessionStepId): void {
        const storage = getStorage();
        if (!storage) {
                return;
        }
        const snapshot = parseProgress(storage.getItem(PROGRESS_STORAGE_KEY));
        if (!snapshot.completed.includes(stepId)) {
                snapshot.completed.push(stepId);
                writeProgress(snapshot);
        }
}

export function clearStep(stepId: SessionStepId): void {
        const storage = getStorage();
        if (!storage) {
                return;
        }
        const snapshot = parseProgress(storage.getItem(PROGRESS_STORAGE_KEY));
        const next = snapshot.completed.filter((entry) => entry !== stepId);
        writeProgress({ completed: next });
}

export function getStepIdForQuiz(quizId: string): SessionStepId | undefined {
        return QUIZ_STEP_LOOKUP[quizId];
}

export function getStepIdForProblem(problemId: string): SessionStepId | undefined {
        return PROBLEM_STEP_LOOKUP[problemId];
}

export function getAllSessionSteps(): SessionStepId[] {
        return [
                'warmup-quiz',
                'topic-deck',
                'dp-coin-change',
                'dp-decode-ways',
                'final-review-quiz'
        ];
}
