import type { PageLoad } from './$types';
import { z } from 'zod';

const DocSchema = z.object({}).loose();

export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch('/admin/firestore');
	let ok = res.ok;
	let payload: unknown = null;
	try {
		payload = await res.json();
	} catch {
		ok = false;
		payload = { error: 'invalid_json' };
	}
	const data = DocSchema.safeParse(payload);
	return {
		ok,
		text: JSON.stringify(data.success ? data.data : payload, null, 2)
	};
};
