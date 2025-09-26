import { env } from '$env/dynamic/private';
import { z } from 'zod';

// Test user IDs must start with "test-admin-", "test-free-", or "test-paid-" followed by 16 alphanumeric characters
const testUserIdRegex = /^(test-(admin|free|paid)-[A-Za-z0-9]{16})$/;

const testUserSchema = z.union([z.undefined(), z.string().regex(testUserIdRegex)]);

const testUser = testUserSchema.parse(env['TEST_USER']);

export function isTestUserAdmin(): boolean {
	return testUser !== undefined && testUser.startsWith('test-admin-');
}

export function isTestUser(): boolean {
	return testUser !== undefined;
}

export function getTestUserId(): string {
	if (testUser === undefined) {
		console.error('No test user ID set');
		throw new Error('No test user ID set');
	}
	return testUser;
}
