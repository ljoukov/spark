import { describe, expect, it } from 'vitest';

import {
	assertSparkChatDocumentUploadConfig,
	hasSparkChatDocumentAttachmentContext,
	SPARK_CHAT_DOCUMENT_UPLOAD_CONFIG_ERROR
} from './chatAttachmentModel';

describe('hasSparkChatDocumentAttachmentContext', () => {
	it('detects document attachments', () => {
		expect(hasSparkChatDocumentAttachmentContext([{ contentType: 'application/pdf' }])).toBe(
			true
		);
	});

	it('ignores image-only context', () => {
		expect(hasSparkChatDocumentAttachmentContext([{ contentType: 'image/png' }])).toBe(false);
	});
});

describe('assertSparkChatDocumentUploadConfig', () => {
	it('throws when document context is present and canonical uploads are unavailable', () => {
		expect(() =>
			assertSparkChatDocumentUploadConfig([{ contentType: 'application/pdf' }], {
				canUseCanonicalFileUploads: false
			})
		).toThrow(SPARK_CHAT_DOCUMENT_UPLOAD_CONFIG_ERROR);
	});

	it('handles carried-forward attachment context, not just current-turn uploads', () => {
		const carriedForwardAttachments = [
			{ contentType: 'image/png' },
			{ contentType: 'application/pdf' }
		];
		expect(() =>
			assertSparkChatDocumentUploadConfig(carriedForwardAttachments, {
				canUseCanonicalFileUploads: false
			})
		).toThrow(SPARK_CHAT_DOCUMENT_UPLOAD_CONFIG_ERROR);
	});

	it('does not throw for image-only context when canonical uploads are unavailable', () => {
		expect(() =>
			assertSparkChatDocumentUploadConfig([{ contentType: 'image/png' }], {
				canUseCanonicalFileUploads: false
			})
		).not.toThrow();
	});

	it('does not throw when canonical uploads are available', () => {
		expect(() =>
			assertSparkChatDocumentUploadConfig([{ contentType: 'application/pdf' }], {
				canUseCanonicalFileUploads: true
			})
		).not.toThrow();
	});
});
