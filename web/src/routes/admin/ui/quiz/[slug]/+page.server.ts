import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getPreviewWithHtml, slugSchema } from '$lib/server/admin/quizPreviews';

export const load: PageServerLoad = async ({ params }) => {
	const parsed = slugSchema.safeParse(params.slug);
	if (!parsed.success) {
		throw error(404, 'Unknown preview');
	}

	const preview = getPreviewWithHtml(parsed.data);
	return {
		slug: parsed.data,
		title: preview.title,
		description: preview.description,
		quiz: preview.quiz
	};
};
