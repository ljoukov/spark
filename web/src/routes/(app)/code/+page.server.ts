import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getOrSelectCurrentSession, listSessions } from '$lib/server/session/repo';
import { createWelcomeSessionForUser, listWelcomeTopicSummaries } from '$lib/server/session/welcomeTemplates';
import type { Actions, PageServerLoad } from './$types';

const startSchema = z.object({
        topic: z.string().trim().min(1, 'topic is required'),
});

export const load: PageServerLoad = async ({ locals }) => {
        const user = locals.appUser;
        if (!user) {
                throw redirect(302, '/welcome');
        }

        const [existing] = await listSessions(user.uid, 1);
        if (existing) {
                const session = await getOrSelectCurrentSession(user.uid).catch((error) => {
                        console.error('Unable to resolve session for redirect', error);
                        return null;
                });
                if (session) {
                        throw redirect(302, `/code/${session.id}`);
                }
        }

        return {
                userId: user.uid,
                topics: listWelcomeTopicSummaries(),
        };
};

export const actions: Actions = {
        start: async ({ request, locals }) => {
                const user = locals.appUser;
                if (!user) {
                        throw redirect(302, '/welcome');
                }

                const formData = await request.formData();
                const parsed = startSchema.safeParse({ topic: formData.get('topic') });
                if (!parsed.success) {
                        return {
                                success: false,
                                errors: parsed.error.flatten().fieldErrors,
                        };
                }

                const session = await createWelcomeSessionForUser(user.uid, parsed.data.topic);

                throw redirect(303, `/code/${session.id}`);
        },
};
