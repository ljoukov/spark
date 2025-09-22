import { base64decode, base64encode } from './base64';
import { expect, test } from 'vitest';

test('base64encode', () => {
	const s = 'hello12';
	const array = new Uint8Array([...s].map((s) => s.charCodeAt(0)));
	const b64 = base64encode(array);
	const url = encodeURIComponent(b64);
	expect(b64).toBe(url);
});

test('base64encode paddings', () => {
	const s = 'hello12';
	const array = new Uint8Array([...s].map((s) => s.charCodeAt(0)));
	expect(base64encode(array)).toStrictEqual('aGVsbG8xMg..');
	expect(base64encode(array, '=')).toStrictEqual('aGVsbG8xMg==');
	expect(base64encode(array, '')).toStrictEqual('aGVsbG8xMg');
	expect(base64decode(base64encode(array))).toStrictEqual(array);
	expect(base64decode(base64encode(array, ''))).toStrictEqual(array);
	expect(base64decode(base64encode(array, '='))).toStrictEqual(array);
});
