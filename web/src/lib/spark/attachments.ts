const SPARK_IMAGE_ATTACHMENT_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'image/heif'
] as const;

const SPARK_DOCUMENT_ATTACHMENT_MIME_TYPES = [
	'application/pdf',
	'text/plain',
	'text/markdown',
	'application/x-tex'
] as const;

const SPARK_SUPPORTED_ATTACHMENT_MIME_TYPES = [
	...SPARK_IMAGE_ATTACHMENT_MIME_TYPES,
	...SPARK_DOCUMENT_ATTACHMENT_MIME_TYPES
] as const;

const SPARK_ATTACHMENT_MIME_BY_EXTENSION: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	heic: 'image/heic',
	heif: 'image/heif',
	pdf: 'application/pdf',
	txt: 'text/plain',
	md: 'text/markdown',
	markdown: 'text/markdown',
	tex: 'application/x-tex',
	ltx: 'application/x-tex',
	latex: 'application/x-tex'
};

const SPARK_ATTACHMENT_EXTENSION_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'application/pdf': 'pdf',
	'text/plain': 'txt',
	'text/markdown': 'md',
	'application/x-tex': 'tex'
};

const SPARK_ATTACHMENT_MIME_ALIASES: Record<string, string> = {
	'image/jpg': 'image/jpeg',
	'image/pjpeg': 'image/jpeg',
	'image/heic-sequence': 'image/heic',
	'image/heif-sequence': 'image/heif',
	'application/x-pdf': 'application/pdf',
	'text/x-markdown': 'text/markdown',
	'text/markdown': 'text/markdown',
	'text/x-tex': 'application/x-tex',
	'text/tex': 'application/x-tex',
	'application/tex': 'application/x-tex',
	'application/x-latex': 'application/x-tex',
	'text/latex': 'application/x-tex'
};

const SPARK_ATTACHMENT_BADGE_BY_MIME: Record<string, string> = {
	'image/jpeg': 'JPG',
	'image/png': 'PNG',
	'image/webp': 'WEBP',
	'image/gif': 'GIF',
	'image/heic': 'HEIC',
	'image/heif': 'HEIF',
	'application/pdf': 'PDF',
	'text/plain': 'TXT',
	'text/markdown': 'MD',
	'application/x-tex': 'TEX'
};

const SPARK_ATTACHMENT_FILE_INPUT_ACCEPT_TOKENS = [
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
	'.gif',
	'.heic',
	'.heif',
	'.pdf',
	'.txt',
	'.md',
	'.markdown',
	'.tex',
	'.ltx',
	'.latex',
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'image/heif',
	'application/pdf',
	'text/plain',
	'text/markdown',
	'application/x-tex'
] as const;

export const SPARK_ATTACHMENT_UNSUPPORTED_MESSAGE =
	'Only JPG, PNG, WEBP, GIF, HEIC/HEIF, PDF, TXT, Markdown, or LaTeX files are supported.';

export const SPARK_ATTACHMENT_FILE_INPUT_ACCEPT =
	SPARK_ATTACHMENT_FILE_INPUT_ACCEPT_TOKENS.join(',');

export function resolveSparkAttachmentExtension(name: string): string {
	const trimmed = name.trim();
	const lastDot = trimmed.lastIndexOf('.');
	if (lastDot < 0 || lastDot === trimmed.length - 1) {
		return '';
	}
	return trimmed.slice(lastDot + 1).toLowerCase();
}

export function normalizeSparkAttachmentMimeType(
	contentType: string | null | undefined
): string | undefined {
	const normalized = contentType?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	const aliased = SPARK_ATTACHMENT_MIME_ALIASES[normalized];
	if (aliased) {
		return aliased;
	}
	return normalized;
}

export function resolveSparkAttachmentMimeTypeFromFilename(
	filename: string | null | undefined
): string | undefined {
	const extension = filename ? resolveSparkAttachmentExtension(filename) : '';
	if (!extension) {
		return undefined;
	}
	return SPARK_ATTACHMENT_MIME_BY_EXTENSION[extension];
}

export function resolveSparkAttachmentExtensionForContentType(
	contentType: string | null | undefined
): string | undefined {
	const normalized = normalizeSparkAttachmentMimeType(contentType);
	if (!normalized) {
		return undefined;
	}
	return SPARK_ATTACHMENT_EXTENSION_BY_MIME[normalized];
}

export function isSparkImageAttachmentMimeType(contentType: string | null | undefined): boolean {
	const normalized = normalizeSparkAttachmentMimeType(contentType);
	if (!normalized) {
		return false;
	}
	return (SPARK_IMAGE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(normalized);
}

export function isSparkPdfAttachmentMimeType(contentType: string | null | undefined): boolean {
	return normalizeSparkAttachmentMimeType(contentType) === 'application/pdf';
}

export function isSparkDocumentAttachmentMimeType(contentType: string | null | undefined): boolean {
	const normalized = normalizeSparkAttachmentMimeType(contentType);
	if (!normalized) {
		return false;
	}
	return (SPARK_DOCUMENT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(normalized);
}

export function isSparkSupportedAttachmentMimeType(
	contentType: string | null | undefined
): boolean {
	const normalized = normalizeSparkAttachmentMimeType(contentType);
	if (!normalized) {
		return false;
	}
	return (SPARK_SUPPORTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(normalized);
}

export function resolveSparkAttachmentMimeType(options: {
	filename?: string | null | undefined;
	claimedContentType?: string | null | undefined;
}): string | undefined {
	const normalizedClaimed = normalizeSparkAttachmentMimeType(options.claimedContentType);
	const filenameMimeType = resolveSparkAttachmentMimeTypeFromFilename(options.filename);

	if (
		normalizedClaimed &&
		(normalizedClaimed === 'text/plain' || normalizedClaimed === 'application/octet-stream') &&
		filenameMimeType
	) {
		return filenameMimeType;
	}
	if (normalizedClaimed && isSparkSupportedAttachmentMimeType(normalizedClaimed)) {
		return normalizedClaimed;
	}
	if (filenameMimeType && isSparkSupportedAttachmentMimeType(filenameMimeType)) {
		return filenameMimeType;
	}
	return undefined;
}

export function isSparkSupportedClientFile(file: Pick<File, 'name' | 'type'>): boolean {
	return (
		resolveSparkAttachmentMimeType({
			filename: file.name,
			claimedContentType: file.type
		}) !== undefined
	);
}

export function resolveSparkAttachmentBadge(options: {
	filename?: string | null | undefined;
	contentType?: string | null | undefined;
}): string {
	const resolvedMimeType = resolveSparkAttachmentMimeType({
		filename: options.filename,
		claimedContentType: options.contentType
	});
	if (resolvedMimeType) {
		return SPARK_ATTACHMENT_BADGE_BY_MIME[resolvedMimeType] ?? 'FILE';
	}
	const extension = resolveSparkAttachmentExtension(options.filename ?? '');
	if (!extension) {
		return 'FILE';
	}
	return extension.toUpperCase();
}
