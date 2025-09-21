import { error } from '@sveltejs/kit';

export function getUrlParam(url: URL, name: string): string {
	const param = url.searchParams.get(name);
	if (typeof param !== 'string' || param.length === 0) {
		throw error(400, `missing "${param}" parameter`);
	}
	return param;
}

export function getHostUrl(url: URL): URL {
	// Support https://cloud.google.com/shell/docs/using-web-preview
	const WEB_HOST = '';
	return WEB_HOST.length > 0
		? new URL(`https://8080-${WEB_HOST}${url.pathname}?${url.searchParams.toString()}`)
		: url;
}
