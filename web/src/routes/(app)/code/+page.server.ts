import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
        getOrSelectCurrentSession,
        listSessions,
        saveSession,
        setCurrentSessionId
} from '$lib/server/session/repo';
import { saveUserQuiz } from '$lib/server/quiz/repo';
import { saveUserProblem } from '$lib/server/code/problemRepo';
import {
        getWelcomeSessionTemplate,
        getWelcomeTopicSummaries
} from '$lib/code/session/welcomeSessions';
import type { PageServerLoad, Actions } from './$types';

const selectionSchema = z.object({
        topicId: z.string().trim().min(1, 'topicId is required')
});

export const load: PageServerLoad = async ({ locals }) => {
        const user = locals.appUser;
        if (!user) {
                throw redirect(302, '/welcome');
        }

        const [existing] = await listSessions(user.uid, 1);
        if (existing) {
                const session = await getOrSelectCurrentSession(user.uid).catch((error) => {
                        console.error('Unable to resolve existing session', error);
                        return null;
                });
                if (session) {
                        throw redirect(302, `/code/${session.id}`);
                }
        }

        return {
                topics: getWelcomeTopicSummaries()
        };
};

export const actions: Actions = {
        choose: async ({ request, locals }) => {
                const user = locals.appUser;
                if (!user) {
                        throw redirect(302, '/welcome');
                }

                const formData = await request.formData();
                const rawTopicId = formData.get('topicId');
                const parsed = selectionSchema.safeParse({
                        topicId: typeof rawTopicId === 'string' ? rawTopicId : ''
                });

                if (!parsed.success) {
                        return fail(400, {
                                message: 'Please select a topic to continue.'
                        });
                }

                const template = getWelcomeSessionTemplate(parsed.data.topicId);
                if (!template) {
                        return fail(404, {
                                message: 'Selected topic was not found.'
                        });
                }

                const [existing] = await listSessions(user.uid, 1);
                if (existing) {
                        const session = await getOrSelectCurrentSession(user.uid).catch(() => null);
                        if (session) {
                                throw redirect(303, `/code/${session.id}`);
                        }
                }

                const sessionId = `${template.session.id}-${randomUUID().slice(0, 8)}`;
                const createdAt = Timestamp.now().toDate();

                await saveSession(user.uid, {
                        id: sessionId,
                        title: template.session.title,
                        createdAt,
                        plan: template.session.plan
                });

                for (const quiz of template.quizzes) {
                        await saveUserQuiz(user.uid, sessionId, quiz);
                }

                for (const problem of template.problems) {
                        await saveUserProblem(user.uid, sessionId, problem);
                }

                await setCurrentSessionId(user.uid, sessionId);

                throw redirect(303, `/code/${sessionId}`);
        }
};
