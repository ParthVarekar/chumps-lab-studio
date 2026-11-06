// Visual check: every effect and preset element on real footage, one frame each.
//   node ../node_modules/tsx/dist/cli.mjs test/gallery.mts <out-dir> [--only name1,name2]
import puppeteer from 'puppeteer-core';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PRESETS } from '../../engine/src/element/presets';

const OUT = process.argv[2];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const SRC = 'D:/ChumpsLabStudio/projects/edit-demo';
const DIR = 'D:/ChumpsLabStudio/projects/_gallery';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
for (const f of ['words.json', 'ocr.json', 'project.json']) cpSync(`${SRC}/${f}`, `${DIR}/${f}`);
for (const d of ['media', 'analysis']) cpSync(`${SRC}/${d}`, `${DIR}/${d}`, { recursive: true });
const edd = JSON.parse(readFileSync(`${SRC}/edd.json`, 'utf8'));
for (const b of edd.beats) { b.layers = []; b.camera = []; b.moods = []; }
edd.audio.sfx = [];
writeFileSync(`${DIR}/edd.json`, JSON.stringify(edd));
const words = JSON.parse(readFileSync(`${SRC}/words.json`, 'utf8')).words.filter((w: { start: number }) => w.start > 36 && w.start < 60).map((w: { text: string; start: number; end: number }) => ({ text: w.text, start: w.start, end: w.end }));

const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const api = async (p: string, b: unknown) => (await fetch(`http://localhost:4173${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json() as Promise<any>;

type Item = { name: string; component: string; props: Record<string, unknown>; box?: { x: number; y: number; w: number; h: number; rotation?: number }; space?: 'screen' | 'stage'; len?: number };
const items: Item[] = [
	{ name: 'highlight-box', component: 'Highlight', props: { shape: 'box' }, box: { x: 30, y: 40, w: 30, h: 14 } },
	{ name: 'highlight-ellipse', component: 'Highlight', props: { shape: 'ellipse', fill: 0.15 }, box: { x: 30, y: 40, w: 30, h: 14 } },
	{ name: 'highlight-underline', component: 'Highlight', props: { shape: 'underline' }, box: { x: 30, y: 44, w: 30, h: 8 } },
	{ name: 'spotlight', component: 'Spotlight', props: {}, box: { x: 30, y: 36, w: 36, h: 20 } },
	{ name: 'blur', component: 'BlurRegion', props: { mode: 'blur' }, box: { x: 30, y: 36, w: 36, h: 20 } },
	{ name: 'blackout', component: 'BlurRegion', props: { mode: 'blackout' }, box: { x: 30, y: 36, w: 36, h: 20 } },
	{ name: 'arrow', component: 'Arrow', props: {}, box: { x: 28, y: 40, w: 22, h: 9, rotation: 12 } },
	{ name: 'click-ripple', component: 'ClickRipple', props: {}, box: { x: 44, y: 38, w: 10, h: 17.8 } },
	{ name: 'step-badge', component: 'StepBadge', props: { n: 2 }, box: { x: 8, y: 20, w: 8, h: 14.2 } },
	{ name: 'lower-third', component: 'LowerThird', props: { title: 'Chumps Lab', subtitle: 'C++ in 2 minutes' } },
	{ name: 'flash', component: 'Flash', props: {}, len: 0.5 },
	{ name: 'fade-black', component: 'FadeBlack', props: {}, len: 1.4 },
	{ name: 'wipe', component: 'Wipe', props: {}, len: 1.4 },
	{ name: 'glitch', component: 'Glitch', props: {}, len: 1.0 },
	{ name: 'vignette', component: 'Vignette', props: {} },
	{ name: 'letterbox', component: 'Letterbox', props: {} },
	{ name: 'captions-pop', component: 'Captions', props: { words, style: 'pop' } },
	{ name: 'captions-line', component: 'Captions', props: { words, style: 'line', size: 0.05, uppercase: false, color: 'accent' } },
	...PRESETS.map((p) => ({ name: `el-${p.id}`, component: 'Generated', props: { spec: p.spec, params: {} }, box: { x: 38, y: 24, w: 24, h: 42.7 }, space: 'stage' as const })),
].filter((i) => !only || only.includes(i.name));

const slot = 1.9;
const t0 = 37;
const plan = items.map((it, k) => ({ ...it, at: t0 + k * slot }));
const ops = plan.map((it) => ({ op: 'add_layer', component: it.component, at: it.at, until: it.at + (it.len ?? 1.7), props: it.props, box: it.box, space: it.space, why: it.name }));
await api('/api/open', { dir: DIR });
const r = await api('/api/ops', { dir: DIR, ops, author: 'user' });
const bad = r.notes.filter((n: { ok: boolean }) => !n.ok);
console.log(`${r.applied}/${ops.length} placed`, bad.map((n: { message: string }) => n.message));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 950 } });
const page = await browser.newPage();
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(`http://localhost:4173/index.html?project=${encodeURIComponent(DIR)}`, { waitUntil: 'load' });
await page.waitForSelector('.stage', { timeout: 20000 });
await new Promise((r2) => setTimeout(r2, 3500));
mkdirSync(OUT, { recursive: true });
for (const it of plan) {
	const t = it.at + (it.len ? it.len * 0.45 : 1.0);
	await page.evaluate((tt) => (window as any).__studio.getState().seekTo(tt), t);
	await new Promise((r2) => setTimeout(r2, 1100));
	const el = await page.$('.stage');
	await el!.screenshot({ path: `${OUT}/${it.name}.png` as `${string}.png` });
}
console.log('screens:', plan.length, errs.length ? `errors: ${errs.join(' | ')}` : 'no page errors');
await browser.close();
rmSync(DIR, { recursive: true, force: true });
process.exit(0);
