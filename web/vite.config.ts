import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import fs from 'node:fs';

const hasCustomCert = !!(process.env.DEV_HTTPS_KEY && process.env.DEV_HTTPS_CERT);
const httpsOption = hasCustomCert
	? {
			key: fs.readFileSync(process.env.DEV_HTTPS_KEY!, 'utf8'),
			cert: fs.readFileSync(process.env.DEV_HTTPS_CERT!, 'utf8')
		}
	: undefined; // plugin will provide cert and enable https when undefined

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson(), basicSsl()],
	server: {
		host: 'localhost',
		port: 8080,
		https: httpsOption
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
