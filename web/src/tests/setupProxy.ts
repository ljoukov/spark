import { ProxyAgent, setGlobalDispatcher } from 'undici';

function getProxyUri(): string | undefined {
	const candidates = [
		process.env.HTTPS_PROXY,
		process.env.https_proxy,
		process.env.HTTP_PROXY,
		process.env.http_proxy
	];

	return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

const proxyUri = getProxyUri();

if (proxyUri) {
	const agent = new ProxyAgent(proxyUri);
	setGlobalDispatcher(agent);
}
