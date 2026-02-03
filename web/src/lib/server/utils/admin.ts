import { z } from 'zod';
import { env } from '$env/dynamic/private';

const adminUserIDsSchema = z.string().array().readonly();

let cachedAdminUserIDs: ReadonlySet<string> | null = null;

function loadAdminUserIDs(): ReadonlySet<string> {
	if (cachedAdminUserIDs) {
		return cachedAdminUserIDs;
	}
	const raw = env.ADMIN_USER_IDS;
	if (!raw || raw.trim().length === 0) {
		cachedAdminUserIDs = new Set();
		return cachedAdminUserIDs;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('ADMIN_USER_IDS must be valid JSON (string array).');
	}
	cachedAdminUserIDs = new Set(adminUserIDsSchema.parse(parsed));
	return cachedAdminUserIDs;
}

export function isUserAdmin(userAuth: { userId: string }): boolean {
	return loadAdminUserIDs().has(userAuth.userId);
}
