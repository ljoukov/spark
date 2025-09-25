import type { LayoutServerLoad } from './$types';
import { isTestUser } from '$lib/server/auth/testUser';

export const load: LayoutServerLoad = async ({ locals }) => {
    return {
        user: locals.appUser,
        authDisabled: isTestUser()
    };
};
