// One frame of an edit through the REAL renderer (not the editor preview): checks things like backdrop blur.
//   npx tsx scripts/still.ts <project-dir> <seconds> <out.png>
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Edd } from '../src/edd/schema';
import { getBundle } from './lib/pipeline';
import { startMediaServer } from './lib/media-server';

const [dirArg, secArg, outArg] = process.argv.slice(2);
const dir = resolve(dirArg);
const edd = Edd.parse(JSON.parse(readFileSync(join(dir, 'edd.json'), 'utf8')));
const t = Number(secArg);
const beatIndex = Math.max(0, edd.beats.findIndex((b) => t >= b.start && t < b.end));
const beat = edd.beats[beatIndex];
const frame = Math.round((t - beat.start) * edd.format.fps);
const { serveUrl } = await getBundle(true);
const media = await startMediaServer(dir);
const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' } });
const inputProps = { edd, assetBase: media.url, beatIndex };
const composition = await selectComposition({ serveUrl, id: 'EddBeat', inputProps, puppeteerInstance: browser, logLevel: 'error' });
await renderStill({ composition, serveUrl, frame, output: resolve(outArg), inputProps, puppeteerInstance: browser, logLevel: 'error' });
console.log('wrote', outArg, `(beat ${beat.id}, frame ${frame})`);
await browser.close({ silent: true });
await media.close();
process.exit(0);
