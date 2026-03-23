import { describe, expect, it } from 'vitest';

import { resolveWorkspaceFilePreviewKind } from './agentRunFilePreview';

describe('resolveWorkspaceFilePreviewKind', () => {
	it('treats inline markdown files as markdown previews', () => {
		expect(
			resolveWorkspaceFilePreviewKind({
				path: 'brief.md',
				content: '# Brief',
				createdAt: new Date('2026-03-23T10:00:00.000Z'),
				updatedAt: new Date('2026-03-23T10:00:00.000Z')
			})
		).toBe('markdown');
	});

	it('treats markdown storage links as markdown previews', () => {
		expect(
			resolveWorkspaceFilePreviewKind({
				path: 'uploads/notes',
				type: 'storage_link',
				storagePath: 'spark/uploads/user-id/abc123',
				contentType: 'text/markdown; charset=utf-8',
				sizeBytes: 42,
				createdAt: new Date('2026-03-23T10:00:00.000Z'),
				updatedAt: new Date('2026-03-23T10:00:00.000Z')
			})
		).toBe('markdown');
	});

	it('treats uploaded txt storage links as text previews', () => {
		expect(
			resolveWorkspaceFilePreviewKind({
				path: 'uploads/transcript.txt',
				type: 'storage_link',
				storagePath: 'spark/uploads/user-id/xyz789',
				contentType: 'text/plain',
				sizeBytes: 84,
				createdAt: new Date('2026-03-23T10:00:00.000Z'),
				updatedAt: new Date('2026-03-23T10:00:00.000Z')
			})
		).toBe('text');
	});

	it('keeps image storage links in the image preview path', () => {
		expect(
			resolveWorkspaceFilePreviewKind({
				path: 'uploads/photo.png',
				type: 'storage_link',
				storagePath: 'spark/uploads/user-id/image123',
				contentType: 'image/png',
				sizeBytes: 1024,
				createdAt: new Date('2026-03-23T10:00:00.000Z'),
				updatedAt: new Date('2026-03-23T10:00:00.000Z')
			})
		).toBe('image');
	});

	it('falls back to the storage-link placeholder for non-previewable linked binaries', () => {
		expect(
			resolveWorkspaceFilePreviewKind({
				path: 'uploads/report.pdf',
				type: 'storage_link',
				storagePath: 'spark/uploads/user-id/pdf123',
				contentType: 'application/pdf',
				sizeBytes: 2048,
				createdAt: new Date('2026-03-23T10:00:00.000Z'),
				updatedAt: new Date('2026-03-23T10:00:00.000Z')
			})
		).toBe('storage_link');
	});
});
