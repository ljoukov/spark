import { ADMIN_USER_IDS } from '$env/static/private';
import { z } from 'zod';

const adminUserIDsSchema = z.string().array().readonly();

const adminUserIDs = new Set(adminUserIDsSchema.parse(JSON.parse(ADMIN_USER_IDS)));

export function isUserAdmin(userAuth: { userId: string }): boolean {
	return adminUserIDs.has(userAuth.userId);
}
