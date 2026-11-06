// Ask the element designer for things in plain English, place them on real footage and screenshot them.
//   node ../node_modules/tsx/dist/cli.mjs test/design.mts <out-dir> "brief one" "brief two" ...
import puppeteer from 'puppeteer-core';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const [OUT, ...briefs] = process.argv.slice(2);
const SRC = 'D:/ChumpsLabStudio/projects/edit-demo';
const DIR = 'D:/ChumpsLabStudio/projects/_design';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
for (const f of ['words.json', 'ocr.json', 'project.json']) cpSync(`${SRC}/${f}`, `${DIR}/${f}`);
for (const d of ['media', 'analysis']) cpSync(`${SRC}/${d}`, `${DIR}/${d}`, { recursive: true });
const edd = JSON.parse(readFileSync(`${SRC}/edd.json`, 'utf8'));
for (const b of edd.beats) { b.layers = []; b.camera = []; b.moods = []; }
edd.audio.sfx = [];
writeFileSync(`${DIR}/edd.json`, JSON.stringify(edd));

const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const api = async (p: string, b: unknown) => (await fetch(`http://localhost:4173${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json() as Promise<any>;
await api('/api/open', { dir: DIR });

const region = { x: 66, y: 22, w: 22, h: 39 };
const placed: { brief: string; at: number; id: string }[] = [];
let at = Number(process.env.START ?? 38);
for (const brief of briefs) {
	const t0 = Date.now();
	const r = await api('/api/elements/design', { dir: DIR, brief, region, time: at, duration: 4 });
	const errs = (r.issues ?? []).filter((i: any) => i.level === 'error').map((i: any) => i.message);
	console.log(`\n"${brief}"  ${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.attempts} attempt(s): ${r.ok ? 'OK' : 'FAILED'} | ${r.say}`);
	if (r.spec) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/spec-${briefs.indexOf(brief)}.json`, JSON.stringify(r.spec, null, 1)); }
	if (r.spec) console.log('  params:', r.spec.params.map((p: any) => `${p.key}${p.type === 'number' ? `(${p.min}-${p.max})` : `:${p.type}`}=${p.default}`).join(', '));
	if (errs.length) console.log('  errors:', errs.slice(0, 3));
	for (const w of (r.issues ?? []).filter((i: any) => i.level === 'warn').slice(0, 3)) console.log('  warn:', w.message);
	if (r.op) {
		const o = await api('/api/ops', { dir: DIR, ops: [r.op], author: 'ai' });
		placed.push({ brief, at, id: o.notes[0].id });
		at += 5;
	}
}

if (placed.length) {
	const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 950 } });
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
	await page.goto(`http://localhost:4173/index.html?project=${encodeURIComponent(DIR)}`, { waitUntil: 'load' });
	await page.waitForSelector('.stage', { timeout: 20000 });
	await new Promise((r) => setTimeout(r, 3500));
	mkdirSync(OUT, { recursive: true });
	for (const [k, p] of placed.entries()) {
		for (const dt of [0.3, 1.2, 2.6]) {
			await page.evaluate((t) => (window as any).__studio.getState().seekTo(t), p.at + dt);
			await new Promise((r) => setTimeout(r, 1000));
			await (await page.$('.stage'))!.screenshot({ path: `${OUT}/d${k}-${dt}.png` as `${string}.png` });
		}
	}
	await browser.close();
	if (errors.length) console.log('page errors:', errors);
}
rmSync(DIR, { recursive: true, force: true });
process.exit(0);
