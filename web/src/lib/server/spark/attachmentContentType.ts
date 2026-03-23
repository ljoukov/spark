import {
	isSparkDocumentAttachmentMimeType,
	resolveSparkAttachmentMimeType
} from '../../spark/attachments';

const HEIC_MAJOR_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const HEIF_MAJOR_BRANDS = new Set(['mif1', 'msf1']);

function readAsciiToken(buffer: Uint8Array, offset: number): string | null {
	if (buffer.length < offset + 4) {
		return null;
	}
	let token = '';
	for (let i = 0; i < 4; i += 1) {
		token += String.fromCharCode(buffer[offset + i] ?? 0);
	}
	return token;
}

function detectHeifContentType(buffer: Uint8Array): string | null {
	const boxType = readAsciiToken(buffer, 4);
	if (boxType !== 'ftyp') {
		return null;
	}
	const maxOffset = Math.min(buffer.length - 4, 64);
	for (let offset = 8; offset <= maxOffset; offset += 4) {
		const brand = readAsciiToken(buffer, offset);
		if (!brand) {
			continue;
		}
		const normalizedBrand = brand.toLowerCase();
		if (HEIC_MAJOR_BRANDS.has(normalizedBrand)) {
			return 'image/heic';
		}
		if (HEIF_MAJOR_BRANDS.has(normalizedBrand)) {
			return 'image/heif';
		}
	}
	return null;
}

function detectBinaryContentType(buffer: Uint8Array): string | null {
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'image/png';
	}
	if (
		buffer.length >= 12 &&
		buffer[0] === 0x52 &&
		buffer[1] === 0x49 &&
		buffer[2] === 0x46 &&
		buffer[3] === 0x46 &&
		buffer[8] === 0x57 &&
		buffer[9] === 0x45 &&
		buffer[10] === 0x42 &&
		buffer[11] === 0x50
	) {
		return 'image/webp';
	}
	if (
		buffer.length >= 6 &&
		buffer[0] === 0x47 &&
		buffer[1] === 0x49 &&
		buffer[2] === 0x46 &&
		buffer[3] === 0x38 &&
		(buffer[4] === 0x37 || buffer[4] === 0x39) &&
		buffer[5] === 0x61
	) {
		return 'image/gif';
	}
	const heifContentType = detectHeifContentType(buffer);
	if (heifContentType) {
		return heifContentType;
	}
	if (
		buffer.length >= 5 &&
		buffer[0] === 0x25 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x44 &&
		buffer[3] === 0x46 &&
		buffer[4] === 0x2d
	) {
		return 'application/pdf';
	}
	return null;
}

function hasUnexpectedControlCharacters(text: string): boolean {
	for (const character of text) {
		const code = character.charCodeAt(0);
		if (code === 0x09 || code === 0x0a || code === 0x0d) {
			continue;
		}
		if (code < 0x20 || code === 0x7f) {
			return true;
		}
	}
	return false;
}

function isUtf8TextDocument(buffer: Uint8Array): boolean {
	for (const byte of buffer) {
		if (byte === 0x00) {
			return false;
		}
	}
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		return false;
	}
	if (text.trim().length === 0) {
		return true;
	}
	return !hasUnexpectedControlCharacters(text);
}

export function detectSparkAttachmentContentType(options: {
	buffer: Uint8Array;
	filename?: string | null | undefined;
	claimedContentType?: string | null | undefined;
}): string | null {
	const binaryContentType = detectBinaryContentType(options.buffer);
	if (binaryContentType) {
		return binaryContentType;
	}
	const resolvedContentType = resolveSparkAttachmentMimeType({
		filename: options.filename,
		claimedContentType: options.claimedContentType
	});
	if (!resolvedContentType) {
		return null;
	}
	if (!isSparkDocumentAttachmentMimeType(resolvedContentType)) {
		return null;
	}
	if (!isUtf8TextDocument(options.buffer)) {
		return null;
	}
	return resolvedContentType;
}
