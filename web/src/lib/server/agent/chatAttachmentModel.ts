import {
	isSparkDocumentAttachmentMimeType,
	normalizeSparkAttachmentMimeType
} from '$lib/spark/attachments';

type SparkChatAttachmentContext = {
	contentType: string;
};

export const SPARK_CHAT_DOCUMENT_UPLOAD_CONFIG_ERROR =
	'Spark chat document uploads are unavailable because canonical file uploads are not configured.';

export function hasSparkChatDocumentAttachmentContext(
	attachments: readonly SparkChatAttachmentContext[]
): boolean {
	for (const attachment of attachments) {
		const normalizedMimeType = normalizeSparkAttachmentMimeType(attachment.contentType);
		if (normalizedMimeType && isSparkDocumentAttachmentMimeType(normalizedMimeType)) {
			return true;
		}
	}
	return false;
}

export function assertSparkChatDocumentUploadConfig(
	attachments: readonly SparkChatAttachmentContext[],
	options: { canUseCanonicalFileUploads: boolean }
): void {
	if (options.canUseCanonicalFileUploads) {
		return;
	}
	if (hasSparkChatDocumentAttachmentContext(attachments)) {
		throw new Error(SPARK_CHAT_DOCUMENT_UPLOAD_CONFIG_ERROR);
	}
}
