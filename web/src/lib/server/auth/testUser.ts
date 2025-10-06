import { env } from '$env/dynamic/private';
import { z } from 'zod';

// Test user IDs must start with "test-admin-", "test-free-", or "test-paid-" followed by 16 alphanumeric characters
const testUserIdRegex = /^(test-(admin|free|paid)-[A-Za-z0-9]{16})$/;

const testUserSchema = z.union([z.undefined(), z.string().regex(testUserIdRegex)]);

const testUserId = (() => {
	if (
		env['FORCE_TEST_USER'] === undefined ||
		env['FORCE_TEST_USER'].toLocaleLowerCase() === 'false'
	) {
		return undefined;
	}
	const id = testUserSchema.parse(env['TEST_USER']);
	if (id !== undefined) {
		console.log('testUserId: running as test user');
	}
	return id;
})();

export function isTestUserAdmin(): boolean {
	return testUserId !== undefined && testUserId.startsWith('test-admin-');
}

export function isTestUser(): boolean {
	return testUserId !== undefined;
}

export function getTestUserId(): string {
	if (testUserId === undefined) {
		console.error('No test user ID set');
		throw new Error('No test user ID set');
	}
	return testUserId;
}
