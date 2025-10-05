import { json, type RequestHandler } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { Workspace, PositionEncoding } from '@astral-sh/ruff-wasm-nodejs';
import { z } from 'zod';
import { authenticateApiRequest } from '$lib/server/auth/apiAuth';

const MAX_CONTENT_LENGTH = 200_000;
const SUPPORTED_ALGORITHMS = ['sha256', 'sha512'] as const;
type HashAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const bodySchema = z
	.object({
		content: z
			.string()
			.max(
				MAX_CONTENT_LENGTH,
				`content must not exceed ${MAX_CONTENT_LENGTH.toLocaleString()} characters`
			),
		hash: z
			.string()
			.trim()
			.regex(/^(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{128})$/, 'hash must be 64 or 128 hex characters'),
		algorithm: z.enum(SUPPORTED_ALGORITHMS).optional()
	})
	.superRefine((value, ctx) => {
		if (!value.algorithm) {
			return;
		}
		const expectedLength = value.algorithm === 'sha256' ? 64 : 128;
		if (value.hash.length !== expectedLength) {
			ctx.addIssue({
				code: 'custom',
				path: ['hash'],
				message: `hash must be ${expectedLength} characters when algorithm is ${value.algorithm}`
			});
		}
	})
	.transform(({ content, hash, algorithm }) => ({
		content,
		hash: hash.toLowerCase(),
		algorithm: (algorithm ?? (hash.length === 128 ? 'sha512' : 'sha256')) as HashAlgorithm
	}));

function computeHash(algorithm: HashAlgorithm, content: string): string {
	return createHash(algorithm).update(content, 'utf8').digest('hex');
}

function formatPython(content: string): string {
	const workspace = new Workspace(
		{
			'indent-width': 2,
			format: {
				'indent-style': 'space',
				'quote-style': 'single'
			}
		},
		PositionEncoding.Utf16
	);
	try {
		return workspace.format(content);
	} finally {
		workspace.free();
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const authResult = await authenticateApiRequest(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	let parsed;
	try {
		const raw = await request.json();
		parsed = bodySchema.parse(raw);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return json({ error: 'invalid_body', issues: error.issues }, { status: 400 });
		}
		return json(
			{ error: 'invalid_body', message: 'Unable to parse request body as JSON' },
			{ status: 400 }
		);
	}

	const { content, hash, algorithm } = parsed;
	const computedOriginalHash = computeHash(algorithm, content);

	if (computedOriginalHash !== hash) {
		return json(
			{
				error: 'hash_mismatch',
				message: 'Provided hash does not match the supplied content',
				expectedHash: computedOriginalHash,
				receivedHash: hash
			},
			{ status: 409 }
		);
	}

	let formatted: string;
	try {
		formatted = formatPython(content);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to format Python source';
		return json({ error: 'format_failed', message }, { status: 422 });
	}

	const formattedHash = computeHash(algorithm, formatted);

	return json({
		formatted,
		unchanged: formatted === content,
		hashes: {
			algorithm,
			original: computedOriginalHash,
			formatted: formattedHash
		}
	});
};
