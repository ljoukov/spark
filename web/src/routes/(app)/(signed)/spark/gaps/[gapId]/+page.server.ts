import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { renderMarkdownOptional } from '$lib/markdown';
import { getLearningGap } from '$lib/server/gaps/repo';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.appUser;
	if (!user) {
		throw redirect(302, '/login');
	}

	const gap = await getLearningGap(user.uid, params.gapId);
	if (!gap) {
		throw error(404, 'Gap not found');
	}

	return {
		gap: {
			...gap,
			steps: gap.steps.map((step) => {
				if (step.kind === 'free_text') {
					return {
						...step,
						promptHtml: renderMarkdownOptional(step.prompt),
						modelAnswerHtml: renderMarkdownOptional(step.modelAnswer)
					};
				}
				if (step.kind === 'multiple_choice') {
					return {
						...step,
						promptHtml: renderMarkdownOptional(step.prompt),
						explanationHtml: renderMarkdownOptional(step.explanation),
						options: step.options.map((option) => ({
							...option,
							textHtml: renderMarkdownOptional(option.text)
						}))
					};
				}
				return {
					...step,
					promptHtml: renderMarkdownOptional(step.prompt),
					bodyHtml: renderMarkdownOptional(step.body)
				};
			}),
			createdAt: gap.createdAt.toISOString(),
			updatedAt: gap.updatedAt.toISOString()
		}
	};
};
