import type { Cookies } from '@sveltejs/kit';
import { z } from 'zod';

import {
	AUTH_SESSION_COOKIE_NAME,
	AUTH_SESSION_MAX_AGE_SECONDS
} from '$lib/auth/constants';
import { decodeString, encodeString } from '$lib/server/utils/encoding';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const NullableTrimmedStringSchema = z.union([z.string(), z.null()]).transform((value) => {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
});

const NullableEmailSchema = z.union([z.string(), z.null()]).transform((value) => {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
});

const AppSessionSchema = z.object({
	v: z.literal(1),
	uid: z.string().trim().min(1),
	email: NullableEmailSchema,
	name: NullableTrimmedStringSchema,
	photoUrl: NullableTrimmedStringSchema,
	isAnonymous: z.boolean(),
	iat: z.number().int().positive(),
	exp: z.number().int().positive()
});

export type AppSession = z.output<typeof AppSessionSchema>;

export type AppSessionUser = {
	uid: string;
	email: string | null;
	name: string | null;
	photoUrl: string | null;
	isAnonymous: boolean;
};

function secureCookieFor(url: URL): boolean {
	return url.protocol === 'https:';
}

export function clearAppSessionCookie(cookies: Cookies): void {
	cookies.delete(AUTH_SESSION_COOKIE_NAME, { path: '/' });
}

export async function setAppSessionCookie(cookies: Cookies, url: URL, user: AppSessionUser): Promise<void> {
	const issuedAt = nowSeconds();
	const session: AppSession = {
		v: 1,
		uid: user.uid.trim(),
		email: user.email,
		name: user.name,
		photoUrl: user.photoUrl,
		isAnonymous: user.isAnonymous,
		iat: issuedAt,
		exp: issuedAt + AUTH_SESSION_MAX_AGE_SECONDS
	};

	const encoded = await encodeString(JSON.stringify(session));
	cookies.set(AUTH_SESSION_COOKIE_NAME, encoded, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: secureCookieFor(url),
		maxAge: AUTH_SESSION_MAX_AGE_SECONDS
	});
}

export async function readAppSessionCookieValue(raw: string | null | undefined): Promise<AppSession | null> {
	if (!raw || raw.trim().length === 0) {
		return null;
	}
	try {
		const decoded = await decodeString(raw);
		const parsedJson: unknown = JSON.parse(decoded);
		const parsed = AppSessionSchema.safeParse(parsedJson);
		if (!parsed.success) {
			return null;
		}
		if (parsed.data.exp <= nowSeconds()) {
			return null;
		}
		return parsed.data;
	} catch {
		return null;
	}
}

