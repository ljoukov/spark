import { fail, redirect } from '@sveltejs/kit';
import {
        getSession,
        getCurrentSessionId,
        listSessions,
        setCurrentSessionId,
        saveSession
} from '$lib/server/session/repo';
import { saveUserQuiz } from '$lib/server/quiz/repo';
import { saveUserProblem } from '$lib/server/code/problemRepo';
import { findWelcomeTopic, getWelcomeTopics } from '$lib/server/session/welcomeTopics';
import { Timestamp } from 'firebase-admin/firestore';
import { SessionSchema } from '@spark/schemas';
import { z } from 'zod';
import type { PageServerLoad, Actions } from './$types';

const selectionSchema = z.object({ topicId: z.string().trim().min(1) });

export const load: PageServerLoad = async ({ locals }) => {
        const user = locals.appUser;
        if (!user) {
                throw redirect(302, '/welcome');
        }

        const currentSessionId = await getCurrentSessionId(user.uid);
        if (currentSessionId) {
                const existing = await getSession(user.uid, currentSessionId);
                if (existing) {
                        throw redirect(302, `/code/${existing.id}`);
                }
        }

        const [latest] = await listSessions(user.uid, 1);
        if (latest) {
                await setCurrentSessionId(user.uid, latest.id).catch((error) => {
                        console.warn('Unable to update currentSessionId', error);
                });
                throw redirect(302, `/code/${latest.id}`);
        }

        const topics = getWelcomeTopics().map((topic) => ({
                id: topic.id,
                title: topic.title,
                tagline: topic.tagline,
                description: topic.description,
                takeaways: topic.takeaways,
                plan: topic.plan.map((item) => ({
                        id: item.id,
                        title: item.title,
                        meta: item.meta ?? null,
                        icon: item.icon ?? null,
                        kind: item.kind
                }))
        }));

        return { topics };
};

export const actions: Actions = {
        selectTopic: async ({ request, locals }) => {
                const user = locals.appUser;
                if (!user) {
                        throw redirect(302, '/welcome');
                }

                const formData = await request.formData();
                const parsed = selectionSchema.safeParse(Object.fromEntries(formData));
                if (!parsed.success) {
                        return fail(400, {
                                message: 'Please choose a topic to continue.'
                        });
                }

                const topic = findWelcomeTopic(parsed.data.topicId);
                if (!topic) {
                        return fail(400, {
                                message: 'That topic is no longer available. Please refresh and try again.'
                        });
                }

                const session = SessionSchema.parse({
                        id: topic.id,
                        title: topic.plan[0]?.title ?? topic.title,
                        createdAt: Timestamp.now(),
                        plan: topic.plan
                });

                try {
                        await saveSession(user.uid, session);
                        await Promise.all(
                                topic.quizzes.map((quiz) => saveUserQuiz(user.uid, session.id, quiz))
                        );
                        await Promise.all(
                                topic.problems.map((problem) => saveUserProblem(user.uid, session.id, problem))
                        );
                        await setCurrentSessionId(user.uid, session.id);
                } catch (error) {
                        console.error('Failed to store welcome session', error);
                        return fail(500, {
                                message: 'We could not save your new session. Please try again in a moment.'
                        });
                }

                return {
                        success: true,
                        sessionId: session.id
                };
        }
};
