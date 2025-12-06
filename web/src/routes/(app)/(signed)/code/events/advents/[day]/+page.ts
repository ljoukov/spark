import { error, redirect } from '@sveltejs/kit';
import { adventBundles, getBundleByDay } from '$lib/data/adventSessions';
import type { PageLoad } from './$types';

const todayDay = (): number => {
	const now = new Date();
	return now.getDate();
};

export const load: PageLoad = ({ params, url }) => {
	const day = Number(params.day);
	if (!Number.isInteger(day) || day < 1 || day > adventBundles.length) {
		throw error(404, 'Advent day not found');
	}
	if (day > todayDay()) {
		throw redirect(302, '/code/events/advents');
	}
	const bundle = getBundleByDay(day);
	if (!bundle) {
		throw error(404, 'Advent session missing');
	}
	return {
		day,
		bundle,
		referrer: url.searchParams.get('from') ?? '/code/events/advents'
	};
};
