import { error } from '@sveltejs/kit';

import { PreviewDetailSchema, PreviewIndexSchema } from '$lib/types/adminPreview';
import type { PageLoad } from './$types';

const STATIC_INDEX_PATH = '/admin-preview-data/index.json';
const STATIC_ENTRY_PREFIX = '/admin-preview-data/';

export const load = (async ({ fetch }) => {
	const indexResponse = await fetch(STATIC_INDEX_PATH, { cache: 'no-store' });
	if (!indexResponse.ok) {
		throw error(indexResponse.status, 'Failed to load admin preview index.');
	}

	const indexJson = await indexResponse.json();
	const index = PreviewIndexSchema.parse(indexJson);

	const entries = [];
	for (const entry of index.entries) {
		const detailResponse = await fetch(`${STATIC_ENTRY_PREFIX}${entry.outputFile}`, {
			cache: 'no-store'
		});
		if (!detailResponse.ok) {
			throw error(detailResponse.status, `Failed to load preview details for ${entry.outputFile}.`);
		}
		const detailJson = await detailResponse.json();
		const detail = PreviewDetailSchema.parse(detailJson);
		entries.push(detail);
	}

	return {
		generatedAt: index.generatedAt,
		entries
	};
}) satisfies PageLoad;
