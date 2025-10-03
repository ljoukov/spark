import { writable } from 'svelte/store';
import type { CodeProgressState, CodeProgressStepKey } from '$lib/types/code-progress';

const STORAGE_KEY = 'spark-code-progress';

const defaultState: CodeProgressState = {
        warmup: false,
        topic: false,
        'problem-one': false,
        'problem-two': false,
        review: false
};

function loadFromStorage(): CodeProgressState {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
                return { ...defaultState };
        }

        try {
                const raw = window.localStorage.getItem(STORAGE_KEY);
                if (!raw) {
                        return { ...defaultState };
                }
                const parsed = JSON.parse(raw) as Partial<CodeProgressState>;
                return { ...defaultState, ...parsed };
        } catch (error) {
                console.error('Failed to read code progress from storage', error);
                return { ...defaultState };
        }
}

function persist(state: CodeProgressState) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
                return;
        }
        try {
                        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
                console.error('Failed to persist code progress', error);
        }
}

const { subscribe, set, update } = writable<CodeProgressState>(loadFromStorage());

function sync() {
        set(loadFromStorage());
}

function markComplete(step: CodeProgressStepKey) {
        update((state) => {
                if (state[step]) {
                        return state;
                }
                const next = { ...state, [step]: true } as CodeProgressState;
                persist(next);
                return next;
        });
}

function reset() {
        persist(defaultState);
        set({ ...defaultState });
}

function getSnapshot(): CodeProgressState {
        return loadFromStorage();
}

export const codeProgress = {
        subscribe,
        sync,
        markComplete,
        reset,
        getSnapshot,
        defaultState: { ...defaultState }
};

export type { CodeProgressState, CodeProgressStepKey };
