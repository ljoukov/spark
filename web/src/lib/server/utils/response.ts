export function clientSideRedirect(url: URL): Response {
	return new Response(
		`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url='${url.toString()}'"></head><body></body></html>`,
		{
			headers: {
				'content-type': 'text/html'
			}
		}
	);
}
