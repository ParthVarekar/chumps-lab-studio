// Copies the bundled OFL fonts from @fontsource into public/fonts (run after npm install).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
mkdirSync(out, { recursive: true });

const files = [
	['@fontsource/archivo-black', 'archivo-black-latin-400-normal.woff2'],
	['@fontsource/inter', 'inter-latin-600-normal.woff2'],
	['@fontsource/inter', 'inter-latin-800-normal.woff2'],
	['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2'],
];
for (const [pkg, file] of files) {
	const src = join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file);
	copyFileSync(src, join(out, file));
	console.log('copied', file);
}
