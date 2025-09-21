import { decodeString, encodeString } from './encoding';
import { test, expect } from 'vitest';

test('encodeDecodeString', async () => {
	expect(await decodeString(await encodeString('hello world'))).toStrictEqual('hello world');
});

test('encodeString', async () => {
	const s1 = await encodeString('hello world');
	const s2 = await encodeString('HELLO WORLD');
	expect(s1.length).toStrictEqual(s2.length);
	expect(typeof s1).toStrictEqual('string');
	expect(typeof s2).toStrictEqual('string');
});
