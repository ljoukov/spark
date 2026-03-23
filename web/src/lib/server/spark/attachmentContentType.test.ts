import { describe, expect, it } from 'vitest';

import { detectSparkAttachmentContentType } from './attachmentContentType';

describe('detectSparkAttachmentContentType', () => {
	it('detects jpeg content from magic bytes', () => {
		expect(
			detectSparkAttachmentContentType({
				buffer: Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
				filename: 'photo.jpg',
				claimedContentType: 'image/jpeg'
			})
		).toBe('image/jpeg');
	});

	it('detects pdf content from magic bytes', () => {
		expect(
			detectSparkAttachmentContentType({
				buffer: new TextEncoder().encode('%PDF-1.7\n'),
				filename: 'paper.pdf',
				claimedContentType: 'application/pdf'
			})
		).toBe('application/pdf');
	});

	it('detects markdown, latex, and txt utf-8 documents', () => {
		expect(
			detectSparkAttachmentContentType({
				buffer: new TextEncoder().encode('# Heading\n'),
				filename: 'notes.md',
				claimedContentType: 'text/plain'
			})
		).toBe('text/markdown');
		expect(
			detectSparkAttachmentContentType({
				buffer: new TextEncoder().encode('\\section{Intro}\n'),
				filename: 'notes.tex',
				claimedContentType: 'text/plain'
			})
		).toBe('application/x-tex');
		expect(
			detectSparkAttachmentContentType({
				buffer: new TextEncoder().encode('plain text\n'),
				filename: 'notes.txt',
				claimedContentType: 'text/plain'
			})
		).toBe('text/plain');
	});

	it('rejects binary data disguised as text', () => {
		expect(
			detectSparkAttachmentContentType({
				buffer: Uint8Array.from([0x01, 0x02, 0x03, 0x04]),
				filename: 'payload.txt',
				claimedContentType: 'text/plain'
			})
		).toBeNull();
	});
});
