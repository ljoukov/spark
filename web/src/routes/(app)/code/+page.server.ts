import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getOrSelectCurrentSession, listSessions } from '$lib/server/session/repo';
import {
  listWelcomeSessionOptions,
  provisionWelcomeSession,
} from '$lib/server/session/welcomeSessions';
import type { PageServerLoad, Actions } from './$types';

const selectionSchema = z.object({
  topic: z.enum(['modular-magic', 'binary-sparks', 'digital-roots']),
});

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.appUser;
  if (!user) {
    throw redirect(302, '/welcome');
  }

  const sessions = await listSessions(user.uid, 1);
  if (sessions.length > 0) {
    const session = await getOrSelectCurrentSession(user.uid);
    throw redirect(302, `/code/${session.id}`);
  }

  return {
    welcomeOptions: listWelcomeSessionOptions(),
    userName: user.name ?? null,
  };
};

export const actions: Actions = {
  start: async ({ request, locals }) => {
    const user = locals.appUser;
    if (!user) {
      throw redirect(302, '/welcome');
    }

    const formData = await request.formData();
    const parsed = selectionSchema.safeParse({ topic: formData.get('topic') });
    if (!parsed.success) {
      return fail(400, { error: 'Please choose a topic to begin.' });
    }

    try {
      const session = await provisionWelcomeSession(user.uid, parsed.data.topic);
      throw redirect(303, `/code/${session.id}`);
    } catch (error) {
      console.error('Unable to provision welcome session', error);
      return fail(500, { error: 'We could not start that session. Please try again.' });
    }
  },
};
