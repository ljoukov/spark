import { ADMIN_USER_IDS } from '$env/static/private';
import { z } from 'zod';

const adminUserIDsSchema = z.string().array().readonly();

const adminUserIDs = adminUserIDsSchema.parse(JSON.parse(ADMIN_USER_IDS));

export function getAdminUserIDs(): readonly string[] {
	return adminUserIDs;
}
