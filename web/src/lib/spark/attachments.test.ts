import { describe, expect, it } from 'vitest';

import {
	isSparkSupportedClientFile,
	resolveSparkAttachmentBadge,
	resolveSparkAttachmentMimeType
} from './attachments';

describe('resolveSparkAttachmentMimeType', () => {
	it('upgrades markdown files from text/plain to text/markdown', () => {
		expect(
			resolveSparkAttachmentMimeType({
				filename: 'notes.md',
				claimedContentType: 'text/plain'
			})
		).toBe('text/markdown');
	});

	it('upgrades latex files from text/plain to application/x-tex', () => {
		expect(
			resolveSparkAttachmentMimeType({
				filename: 'worksheet.tex',
				claimedContentType: 'text/plain'
			})
		).toBe('application/x-tex');
	});
});

describe('isSparkSupportedClientFile', () => {
	it('accepts txt and markdown files', () => {
		expect(isSparkSupportedClientFile(new File(['hello'], 'brief.txt', { type: 'text/plain' }))).toBe(
			true
		);
		expect(
			isSparkSupportedClientFile(new File(['# hi'], 'brief.markdown', { type: 'text/plain' }))
		).toBe(true);
	});

	it('rejects unsupported files', () => {
		expect(
			isSparkSupportedClientFile(new File(['{"ok":true}'], 'payload.json', { type: 'application/json' }))
		).toBe(false);
	});
});

describe('resolveSparkAttachmentBadge', () => {
	it('returns document badges', () => {
		expect(
			resolveSparkAttachmentBadge({
				filename: 'paper.pdf',
				contentType: 'application/pdf'
			})
		).toBe('PDF');
		expect(
			resolveSparkAttachmentBadge({
				filename: 'notes.txt',
				contentType: 'text/plain'
			})
		).toBe('TXT');
		expect(
			resolveSparkAttachmentBadge({
				filename: 'notes.md',
				contentType: 'text/markdown'
			})
		).toBe('MD');
		expect(
			resolveSparkAttachmentBadge({
				filename: 'equation.tex',
				contentType: 'application/x-tex'
			})
		).toBe('TEX');
	});
});
