import { ADMIN_USER_IDS } from '$env/static/private';
import type { UserAuthProto } from '$proto/AuthProto';
import { z } from 'zod';

const requiredUserAuthProps = ['expiresAt'] as const;
type RequiredUserAuthProps = (typeof requiredUserAuthProps)[number];
export type UserAuth = UserAuthProto & Required<Pick<UserAuthProto, RequiredUserAuthProps>>;

export function isValidUserAuth(userAuth: UserAuthProto): userAuth is UserAuth {
	for (const prop of requiredUserAuthProps) {
		if (userAuth[prop] === undefined) {
			return false;
		}
	}
	return true;
}

const adminUserIdsSchema = z.array(z.string()).nonempty();
const adminUserIds = new Set<string>(adminUserIdsSchema.parse(JSON.parse(ADMIN_USER_IDS)));

export function isAdminUserId(userId: string): boolean {
	return adminUserIds.has(userId);
}
