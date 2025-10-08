import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import { z } from 'zod';
import { getSessionMedia } from '$lib/server/media/repo';
import type { PageServerLoad } from './$types';

marked.setOptions({ gfm: true, breaks: true });

const paramsSchema = z.object({
	id: z.string().trim().min(1, 'Media id is required')
});

function extractSlideParts(markdown: string): { title: string; bodyMarkdown: string } {
	const lines = markdown.split(/\r?\n/);
	let title = '';
	let bodyStart = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const raw = lines[index]?.trim() ?? '';
		if (!raw) {
			continue;
		}
		title = raw.replace(/^#+\s*/, '').trim();
		bodyStart = index + 1;
		break;
	}

	const bodyMarkdown = lines.slice(bodyStart).join('\n').trim();

	return {
		title: title || 'Slide',
		bodyMarkdown
	};
}

function toHtml(markdown: string): string {
	const rendered = marked.parse(markdown);
	return typeof rendered === 'string' ? rendered : '';
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const { id } = paramsSchema.parse(params);
	const { session, userId, sessionState } = await parent();

	const planItem = session.plan.find((item) => item.id === id);
	if (!planItem || planItem.kind !== 'media') {
		throw error(404, { message: 'Media step not found in session plan' });
	}

	const media = await getSessionMedia(userId, session.id, id);
	if (!media) {
		throw error(404, { message: 'Media content not found' });
	}

	const slides = media.slides
		.slice()
		.sort((a, b) => a.index - b.index)
		.map((slide, order) => {
			const { title, bodyMarkdown } = extractSlideParts(slide.markdown);
			const bodyHtml = bodyMarkdown ? toHtml(bodyMarkdown) : '';
			return {
				order,
				index: slide.index,
				title,
				markdown: slide.markdown,
				bodyHtml,
				startSec: slide.startSec,
				durationSec: slide.durationSec
			};
		});

	const captions = media.captions
		.slice()
		.sort((a, b) => a.startSec - b.startSec)
		.map((caption, index) => ({
			index,
			speaker: caption.speaker,
			text: caption.text,
			startSec: caption.startSec,
			durationSec: caption.durationSec
		}));

	return {
		sessionId: session.id,
		planItem,
		sessionState,
		planItemState: sessionState.items[planItem.id] ?? null,
		media: {
			audio: {
				storagePath: media.audio.storagePath,
				mimeType: media.audio.mimeType ?? 'audio/mpeg',
				durationSec: media.audio.durationSec,
				url: media.audio.signedUrl,
				expiresAt: media.audio.signedUrlExpiresAt?.toISOString() ?? null
			},
			slides,
			captions
		}
	};
};
