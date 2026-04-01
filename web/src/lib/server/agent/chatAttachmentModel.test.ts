import { describe, expect, it } from 'vitest';

import { shouldUseGeminiForSparkChatAttachmentContext } from './chatAttachmentModel';

describe('shouldUseGeminiForSparkChatAttachmentContext', () => {
	it('routes document context to Gemini when canonical file uploads are unavailable', () => {
		expect(
			shouldUseGeminiForSparkChatAttachmentContext(
				[{ contentType: 'application/pdf' }],
				{ canUseCanonicalFileUploads: false }
			)
		).toBe(true);
	});

	it('does not route image-only context to Gemini', () => {
		expect(
			shouldUseGeminiForSparkChatAttachmentContext(
				[{ contentType: 'image/png' }],
				{ canUseCanonicalFileUploads: false }
			)
		).toBe(false);
	});

	it('does not route document context to Gemini when canonical file uploads are available', () => {
		expect(
			shouldUseGeminiForSparkChatAttachmentContext(
				[{ contentType: 'application/pdf' }],
				{ canUseCanonicalFileUploads: true }
			)
		).toBe(false);
	});

	it('handles carried-forward attachment context, not just current-turn uploads', () => {
		const carriedForwardAttachments = [
			{ contentType: 'image/png' },
			{ contentType: 'application/pdf' }
		];
		expect(
			shouldUseGeminiForSparkChatAttachmentContext(carriedForwardAttachments, {
				canUseCanonicalFileUploads: false
			})
		).toBe(true);
	});
});
