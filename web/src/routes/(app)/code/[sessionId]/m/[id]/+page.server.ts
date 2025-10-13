import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getSessionMedia } from '$lib/server/media/repo';
import type { SessionMediaImageWithUrl } from '$lib/server/media/repo';
import type { PageServerLoad } from './$types';

const paramsSchema = z.object({
	id: z.string().trim().min(1, 'Media id is required')
});

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

	const images = media.images
		.slice()
		.sort((a, b) => a.startSec - b.startSec || a.index - b.index)
		.map((image, order) => {
			const withUrl = image as SessionMediaImageWithUrl;
			return {
				order,
				index: image.index,
				startSec: image.startSec,
				durationSec: image.durationSec,
				url: withUrl.url,
				storagePath: image.storagePath ?? null,
				signedUrlExpiresAt: withUrl.signedUrlExpiresAt?.toISOString() ?? null
			};
		});

	const narration = media.narration
		.slice()
		.sort((a, b) => a.startSec - b.startSec)
		.map((line, index) => ({
			index,
			speaker: line.speaker ?? null,
			text: line.text,
			startSec: line.startSec,
			durationSec: line.durationSec
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
				url: media.audio.url,
				expiresAt: media.audio.signedUrlExpiresAt?.toISOString() ?? null
			},
			images,
			narration
		}
	};
};
