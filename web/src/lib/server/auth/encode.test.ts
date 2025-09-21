import { Timestamp } from '$proto/google/protobuf/timestamp';
import type { UserAuth } from './auth';
import { decodeUserAuth, encodeUserAuth } from './encode';
import { test, expect } from 'vitest';

test('encodeDecodeUserAuth', async () => {
	const userAuth: UserAuth = {
		accessToken: 'access-token',
		expiresAt: Timestamp.fromDate(new Date()),
		refreshToken: 'refresh-token',
		userId: 'user-1'
	};
	const encodedUserAuth = await encodeUserAuth(userAuth);
	const decodedUserAuth = await decodeUserAuth(encodedUserAuth);
	expect(decodedUserAuth).toStrictEqual(userAuth);
});
