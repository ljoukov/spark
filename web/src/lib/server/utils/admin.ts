import { ADMIN_USER_IDS } from '$env/static/private';
import { z } from 'zod';
import { isTestUserAdmin } from '$lib/server/auth/testUser';

const adminUserIDsSchema = z.string().array().readonly();

const adminUserIDs = new Set(adminUserIDsSchema.parse(JSON.parse(ADMIN_USER_IDS)));

export function isUserAdmin(userAuth: { userId: string }): boolean {
    if (isTestUserAdmin()) {
        return true;
    }
    return adminUserIDs.has(userAuth.userId);
}
