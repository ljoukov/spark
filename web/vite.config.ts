import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const localCertDir = path.join(os.homedir(), '.localhost-certs');
const customKeyPath = path.join(localCertDir, 'localhost-key.pem');
const customCertPath = path.join(localCertDir, 'localhost.pem');
const hasCustomCert = fs.existsSync(customKeyPath) && fs.existsSync(customCertPath);
const httpsOption: HttpsServerOptions | undefined = hasCustomCert
	? {
			key: fs.readFileSync(customKeyPath, 'utf8'),
			cert: fs.readFileSync(customCertPath, 'utf8')
		}
	: undefined; // plugin will provide cert and enable https when undefined
const isHttpsDev = process.env.npm_lifecycle_event === 'dev:https';
const fallbackHttpsOption: HttpsServerOptions = {};
const httpsServerOption: HttpsServerOptions | undefined = isHttpsDev
	? (httpsOption ?? fallbackHttpsOption)
	: undefined;
const plugins = [tailwindcss(), sveltekit(), devtoolsJson(), ...(isHttpsDev ? [basicSsl()] : [])];

const serverOptions = {
	host: 'localhost',
	port: 8080,
	...(httpsServerOption ? { https: httpsServerOption } : {})
};

export default defineConfig({
	plugins,
	server: serverOptions,
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					setupFiles: ['./src/tests/setupProxy.ts']
				}
			}
		]
	}
});
