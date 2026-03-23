import {
	isSparkImageAttachmentMimeType,
	normalizeSparkAttachmentMimeType,
	resolveSparkAttachmentExtension,
	resolveSparkAttachmentExtensionForContentType,
	resolveSparkAttachmentMimeType
} from '$lib/spark/attachments';

export const MAX_SPARK_ATTACHMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_SPARK_ATTACHMENT_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_SPARK_ATTACHMENTS_PER_REPLY = 10;

const MAX_INLINE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const TARGET_IMAGE_ATTACHMENT_BYTES = Math.floor(MAX_INLINE_ATTACHMENT_BYTES * 0.9);
const MAX_IMAGE_NORMALIZATION_ATTEMPTS = 10;
const MIN_IMAGE_NORMALIZATION_QUALITY = 0.55;
const MAX_IMAGE_NORMALIZATION_DIMENSION = 3072;
const MIN_IMAGE_NORMALIZATION_DIMENSION = 640;

export function resolveClientAttachmentContentType(file: File): string {
	return (
		resolveSparkAttachmentMimeType({
			filename: file.name,
			claimedContentType: file.type
		}) ?? normalizeSparkAttachmentMimeType(file.type) ?? ''
	);
}

function isHeicType(contentType: string, filename: string): boolean {
	const normalizedType = normalizeSparkAttachmentMimeType(contentType) ?? '';
	if (normalizedType === 'image/heic' || normalizedType === 'image/heif') {
		return true;
	}
	const ext = resolveSparkAttachmentExtension(filename);
	return ext === 'heic' || ext === 'heif';
}

function isRasterImageType(contentType: string): boolean {
	const normalizedType = normalizeSparkAttachmentMimeType(contentType);
	if (!normalizedType || !isSparkImageAttachmentMimeType(normalizedType)) {
		return false;
	}
	return normalizedType !== 'image/gif';
}

function isClipboardAttachmentFilename(filename: string): boolean {
	return /^clipboard-\d+(?:\.[a-z0-9]+)?$/iu.test(filename.trim().toLowerCase());
}

function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			resolve(image);
		};
		image.onerror = () => {
			reject(new Error('image_load_failed'));
		};
		image.src = objectUrl;
	});
}

export async function normalizeAttachmentForModel(file: File): Promise<File> {
	const contentType = resolveClientAttachmentContentType(file);
	const isHeic = isHeicType(contentType, file.name);
	const isRasterImage = isRasterImageType(contentType);
	const shouldNormalizeImage =
		isHeic ||
		(isRasterImage &&
			(file.size > TARGET_IMAGE_ATTACHMENT_BYTES || isClipboardAttachmentFilename(file.name)));
	if (!shouldNormalizeImage) {
		return file;
	}
	if (typeof document === 'undefined') {
		return file;
	}

	const objectUrl = URL.createObjectURL(file);
	try {
		const image = await loadImageFromObjectUrl(objectUrl);
		const sourceWidth = Math.max(1, image.naturalWidth || image.width);
		const sourceHeight = Math.max(1, image.naturalHeight || image.height);
		const sourceMaxDimension = Math.max(sourceWidth, sourceHeight);
		const initialScale =
			sourceMaxDimension > MAX_IMAGE_NORMALIZATION_DIMENSION
				? MAX_IMAGE_NORMALIZATION_DIMENSION / sourceMaxDimension
				: 1;
		let scale = initialScale;
		let quality = 0.92;
		let bestBlob: Blob | null = null;
		for (let attempt = 1; attempt <= MAX_IMAGE_NORMALIZATION_ATTEMPTS; attempt += 1) {
			const width = Math.max(1, Math.round(sourceWidth * scale));
			const height = Math.max(1, Math.round(sourceHeight * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d');
			if (!context) {
				throw new Error('canvas_context_unavailable');
			}
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, width, height);
			context.drawImage(image, 0, 0, width, height);
			const blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, 'image/jpeg', quality);
			});
			if (!blob) {
				throw new Error('jpeg_encoding_failed');
			}
			if (!bestBlob || blob.size < bestBlob.size) {
				bestBlob = blob;
			}
			if (blob.size <= TARGET_IMAGE_ATTACHMENT_BYTES) {
				bestBlob = blob;
				break;
			}
			if (quality - 0.08 >= MIN_IMAGE_NORMALIZATION_QUALITY) {
				quality = Math.max(MIN_IMAGE_NORMALIZATION_QUALITY, quality - 0.08);
				continue;
			}
			if (scale * 0.82 >= MIN_IMAGE_NORMALIZATION_DIMENSION / sourceMaxDimension) {
				scale *= 0.82;
				quality = 0.92;
				continue;
			}
			break;
		}
		if (!bestBlob) {
			return file;
		}
		const nextExtension = resolveSparkAttachmentExtensionForContentType('image/jpeg') ?? 'jpg';
		const normalizedName = file.name.replace(/\.[^/.]+$/u, '');
		return new File([bestBlob], `${normalizedName || 'upload'}.${nextExtension}`, {
			type: 'image/jpeg',
			lastModified: file.lastModified || Date.now()
		});
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
