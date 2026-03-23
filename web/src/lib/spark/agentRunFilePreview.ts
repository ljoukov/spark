import type { SparkAgentWorkspaceFile } from '@spark/schemas';

export type SparkAgentWorkspaceFilePreviewKind =
	| 'markdown'
	| 'text'
	| 'image'
	| 'storage_link'
	| 'raw';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;
const TEXT_EXTENSIONS = ['.txt'] as const;

function normalizeContentType(value: string | undefined): string {
	return (value?.split(';')[0] ?? '').trim().toLowerCase();
}

function pathHasExtension(path: string, extensions: readonly string[]): boolean {
	const normalizedPath = path.trim().toLowerCase();
	return extensions.some((extension) => normalizedPath.endsWith(extension));
}

function resolveWorkspaceFileContentType(file: SparkAgentWorkspaceFile): string {
	return normalizeContentType(file.contentType);
}

export function isMarkdownWorkspaceFile(file: SparkAgentWorkspaceFile): boolean {
	const contentType = resolveWorkspaceFileContentType(file);
	if (contentType === 'text/markdown' || contentType === 'text/x-markdown') {
		return true;
	}
	return pathHasExtension(file.path, MARKDOWN_EXTENSIONS);
}

export function isPlainTextWorkspaceFile(file: SparkAgentWorkspaceFile): boolean {
	if (isMarkdownWorkspaceFile(file)) {
		return false;
	}
	if (resolveWorkspaceFileContentType(file) === 'text/plain') {
		return true;
	}
	return pathHasExtension(file.path, TEXT_EXTENSIONS);
}

export function isImageWorkspaceFile(file: SparkAgentWorkspaceFile): boolean {
	return resolveWorkspaceFileContentType(file).startsWith('image/');
}

export function resolveWorkspaceFilePreviewKind(
	file: SparkAgentWorkspaceFile
): SparkAgentWorkspaceFilePreviewKind {
	if (isMarkdownWorkspaceFile(file)) {
		return 'markdown';
	}
	if (isPlainTextWorkspaceFile(file)) {
		return 'text';
	}
	if (isImageWorkspaceFile(file)) {
		return 'image';
	}
	if (file.type === 'storage_link') {
		return 'storage_link';
	}
	return 'raw';
}
