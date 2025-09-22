const encTable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('');

const decTable: number[] = [];
for (let i = 0; i < encTable.length; i++) {
	decTable[encTable[i].charCodeAt(0)] = i;
}
decTable['+'.charCodeAt(0)] = encTable.indexOf('-');
decTable['/'.charCodeAt(0)] = encTable.indexOf('_');

export function base64decode(base64Str: string): Uint8Array {
	let es = (base64Str.length * 3) / 4;
	if (base64Str[base64Str.length - 2] == '=' || base64Str[base64Str.length - 2] == '.') {
		es -= 2;
	} else if (base64Str[base64Str.length - 1] == '=' || base64Str[base64Str.length - 1] == '.') {
		es -= 1;
	}
	const bytes = new Uint8Array(es);
	let bytePos = 0;
	let groupPos = 0;
	let b;
	let p = 0;
	for (let i = 0; i < base64Str.length; i++) {
		b = decTable[base64Str.charCodeAt(i)];
		if (b === undefined) {
			// noinspection FallThroughInSwitchStatementJS
			switch (base64Str[i]) {
				case '=':
				case '.':
					groupPos = 0; // reset state when padding found
				// fallsthrough
				case '\n':
				case '\r':
				case '\t':
				case ' ':
					continue; // skip white-space, and padding
				default:
					throw Error(`invalid base64 string. '${base64Str[i]}'`);
			}
		}
		switch (groupPos) {
			case 0:
				p = b;
				groupPos = 1;
				break;
			case 1:
				bytes[bytePos++] = (p << 2) | ((b & 48) >> 4);
				p = b;
				groupPos = 2;
				break;
			case 2:
				bytes[bytePos++] = ((p & 15) << 4) | ((b & 60) >> 2);
				p = b;
				groupPos = 3;
				break;
			case 3:
				bytes[bytePos++] = ((p & 3) << 6) | b;
				groupPos = 0;
				break;
		}
	}
	if (groupPos == 1) {
		throw Error('invalid base64 string.');
	}
	return bytes.subarray(0, bytePos);
}

export function base64encode(bytes: Uint8Array, padding: string = '.'): string {
	let base64 = '';
	let groupPos = 0;
	let b;
	let p = 0;
	for (let i = 0; i < bytes.length; i++) {
		b = bytes[i];
		switch (groupPos) {
			case 0:
				base64 += encTable[b >> 2];
				p = (b & 3) << 4;
				groupPos = 1;
				break;
			case 1:
				base64 += encTable[p | (b >> 4)];
				p = (b & 15) << 2;
				groupPos = 2;
				break;
			case 2:
				base64 += encTable[p | (b >> 6)];
				base64 += encTable[b & 63];
				groupPos = 0;
				break;
		}
	}
	if (groupPos) {
		base64 += encTable[p];
		base64 += padding;
		if (groupPos == 1) {
			base64 += padding;
		}
	}
	return base64;
}

export function base64EncodeUrlSafe(bytes: Uint8Array): string {
	return base64encode(bytes, '=');
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
