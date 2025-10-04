import type { LayoutServerLoad } from './$types';

const MOCK_USER: NonNullable<App.Locals['appUser']> = {
        uid: 'mock-user-id',
        name: 'Spark Learner',
        email: 'sparkie@example.com',
        photoUrl: null,
        isAnonymous: false
};

export const load: LayoutServerLoad = async () => {
        return { user: MOCK_USER };
};
