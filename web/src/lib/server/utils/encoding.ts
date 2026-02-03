import { base64decode, base64encode } from '$lib/utils/base64';
import { env } from '$env/dynamic/private';

const ivLen = 16;
const algorithm = 'AES-GCM';
const encodingVersion = 0xa1;

let pkCache: CryptoKey | undefined;
async function getPrivateKey(): Promise<CryptoKey> {
	if (!pkCache) {
		const secret = env.COOKIE_SECRET_KEY ?? '';
		if (!secret || secret.trim().length === 0) {
			throw Error('getPrivateKey: COOKIE_SECRET_KEY is missing');
		}
		const rawKey = base64decode(secret);
		if (rawKey.length !== 32) {
			throw Error(`getPrivateKey: invalid COOKIE_SECRET_KEY length: ${rawKey.length}`);
		}
		const rawKeyBuffer = rawKey.buffer.slice(
			rawKey.byteOffset,
			rawKey.byteOffset + rawKey.byteLength
		) as ArrayBuffer;
		pkCache = await crypto.subtle.importKey('raw', rawKeyBuffer, algorithm, true, [
			'encrypt',
			'decrypt'
		]);
	}
	return pkCache;
}

export async function encodeBytes(data: Uint8Array): Promise<Uint8Array> {
	const key = await getPrivateKey();

	const iv = crypto.getRandomValues(new Uint8Array(ivLen));
	const encryptedData = await crypto.subtle.encrypt(
		{
			name: algorithm,
			iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer
		},
		key,
		data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
	);
	// "iv" (initial value) and encrypted string.
	return new Uint8Array([encodingVersion, ...iv, ...new Uint8Array(encryptedData)]);
}

export async function decodeBytes(encodedData: Uint8Array): Promise<Uint8Array> {
	const version = encodedData[0]; // Encoding version.
	encodedData = encodedData.subarray(1); // Consume the first byte with encoding version.
	if (version !== encodingVersion) {
		throw Error('Invalid UserAuth version');
	}
	const iv = encodedData.subarray(0, ivLen); // Initial vector
	encodedData = encodedData.subarray(ivLen); // Consume initial vector.
	const encryptedData = encodedData; // Encrypted data goes to the end.
	const key = await getPrivateKey();
	const bin = await crypto.subtle.decrypt(
		{
			name: algorithm,
			iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer
		},
		key,
		encryptedData.buffer.slice(
			encryptedData.byteOffset,
			encryptedData.byteOffset + encryptedData.byteLength
		) as ArrayBuffer
	);
	return new Uint8Array(bin);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encodeString(dataString: string): Promise<string> {
	return base64encode(await encodeBytes(textEncoder.encode(dataString)));
}

export async function decodeString(encodedDataString: string): Promise<string> {
	return textDecoder.decode(await decodeBytes(base64decode(encodedDataString)));
}
