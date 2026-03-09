import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, '..');
const cloudflareOutputDir = path.join(webRoot, '.svelte-kit', 'cloudflare');
const assetsIgnorePath = path.join(cloudflareOutputDir, '.assetsignore');

await mkdir(cloudflareOutputDir, { recursive: true });
await writeFile(assetsIgnorePath, '_worker.js\n.DS_Store\n', 'utf8');
