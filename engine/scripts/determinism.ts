/**
 * Determinism check (roadmap criterion): render 30 evenly spaced frames of the whole edit twice, in
 * two separate browser sessions, and compare SHA-256 hashes of the PNGs.
 *   npm run determinism -- <project>\edd.json
 */
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Edd } from '../src/edd/schema';
import { totalFrames } from '../src/edd/timing';
import { getBundle } from './lib/pipeline';
import { startMediaServer } from './lib/media-server';

const eddPath = resolve(process.argv[2] ?? '');
const projectDir = dirname(eddPath);
const edd = Edd.parse(JSON.parse(readFileSync(eddPath, 'utf8')));
const N = 30;
const frames = Array.from({ length: N }, (_, i) => Math.floor(((i + 0.5) * totalFrames(edd)) / N));
const { serveUrl } = await getBundle();
const outDir = join(projectDir, 'cache', 'determinism');
mkdirSync(outDir, { recursive: true });

const pass = async (n: number): Promise<string[]> => {
	const media = await startMediaServer(projectDir);
	const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' } });
	const inputProps = { edd, assetBase: media.url };
	const composition = await selectComposition({ serveUrl, id: 'EddVideo', inputProps, puppeteerInstance: browser });
	const hashes: string[] = [];
	for (const frame of frames) {
		const output = join(outDir, `p${n}-${String(frame).padStart(5, '0')}.png`);
		await renderStill({ composition, serveUrl, frame, inputProps, output, imageFormat: 'png', puppeteerInstance: browser, chromiumOptions: { gl: 'angle' } });
		hashes.push(createHash('sha256').update(readFileSync(output)).digest('hex'));
	}
	await browser.close({ silent: true });
	await media.close();
	return hashes;
};

const a = await pass(1);
const b = await pass(2);
const mismatched = frames.filter((_, i) => a[i] !== b[i]);
console.log(`${N - mismatched.length}/${N} frames identical across two independent renders`);
if (mismatched.length) console.log('differing frames:', mismatched.join(', '));
process.exit(mismatched.length ? 1 : 0);
