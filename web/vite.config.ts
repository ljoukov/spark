import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
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
	: undefined;
const isHttpsDev = process.env.npm_lifecycle_event === 'dev:https';
// Fail loudly if dev:https is requested but local certs are missing
if (isHttpsDev && !hasCustomCert) {
	const msg = [
		'HTTPS dev requires trusted local certs.',
		`Expected:`,
		`  key:  ${customKeyPath}`,
		`  cert: ${customCertPath}`,
		'',
		'Create them once with mkcert:',
		'  brew install mkcert nss && mkcert -install',
		`  mkdir -p ${localCertDir}`,
		`  mkcert -key-file "${customKeyPath}" \\`,
		`         -cert-file "${customCertPath}" \\`,
		'         localhost 127.0.0.1 ::1'
	].join('\n');
	throw new Error(msg);
}

const httpsServerOption: HttpsServerOptions | undefined = isHttpsDev ? httpsOption : undefined;
const plugins = [tailwindcss(), sveltekit(), devtoolsJson()];

const serverOptions = {
	host: 'localhost',
	port: 8080,
	strictPort: true, // avoid silently switching ports; fail if 8080 is taken
	...(httpsServerOption ? { https: httpsServerOption } : {})
};

export default defineConfig({
	plugins,
	server: {
		...serverOptions,
		fs: {
			// allow symlinked packages under the monorepo root to participate in HMR
			allow: [path.resolve(__dirname, '..')]
		}
	},
	resolve: {
		preserveSymlinks: true
	},

	worker: {
		format: 'es'
	},
    ssr: {
        // Bundle only schemas; keep all server-only heavy libs and @spark/llm external
        noExternal: ['@spark/schemas'],
        external: [
            '@spark/llm',
            'firebase-admin',
            'google-gax',
            'google-auth-library',
            'openai',
            '@google/genai',
			/^@google-cloud\/.*/,
			/^@grpc\/.*/,
			/^protobufjs(\/.*)?$/,
			/^@protobufjs\/.*/,
			/^@opentelemetry\/.*/
		]
	},
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
