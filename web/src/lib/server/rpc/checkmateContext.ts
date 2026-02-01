import { createContextKey } from '@connectrpc/connect';

export type CheckMateWaitUntil = (promise: Promise<void>) => void;

export const CheckMateWaitUntilContextKey = createContextKey<CheckMateWaitUntil | null>(null, {
	description: 'SvelteKit waitUntil for CheckMate RPC handlers'
});
