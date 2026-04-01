import {
	isSparkDocumentAttachmentMimeType,
	normalizeSparkAttachmentMimeType
} from '$lib/spark/attachments';

type SparkChatAttachmentContext = {
	contentType: string;
};

export function shouldUseGeminiForSparkChatAttachmentContext(
	attachments: readonly SparkChatAttachmentContext[],
	options: { canUseCanonicalFileUploads: boolean }
): boolean {
	if (options.canUseCanonicalFileUploads) {
		return false;
	}
	for (const attachment of attachments) {
		const normalizedMimeType = normalizeSparkAttachmentMimeType(attachment.contentType);
		if (normalizedMimeType && isSparkDocumentAttachmentMimeType(normalizedMimeType)) {
			return true;
		}
	}
	return false;
}
