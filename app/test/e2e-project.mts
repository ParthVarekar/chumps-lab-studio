// Project setup and the media bin, driven in a real browser. Needs the studio server running.
//   node ../node_modules/tsx/dist/cli.mjs test/e2e-project.mts [--shots dir]
// Makes a throwaway project ("E2E Project …") and removes it afterwards.
import puppeteer, { type Page } from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cls-e2e-project-'));
const clip = path.join(tmp, 'intro.mp4');
const pic = path.join(tmp, 'logo.png');
const ffmpeg = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status !== 0) throw new Error('ffmpeg failed'); };
ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
ffmpeg(['-f', 'lavfi', '-i', 'color=c=orange:size=300x200:duration=1', '-frames:v', '1', pic]);

let failed = 0;
const ok = (name: string, cond: unknown, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1600, height: 950 } });
const page: Page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
const shot = async (n: string) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${n}.png` as `${string}.png` }); } };
const st = () => page.evaluate(() => { const s = (window as any).__studio.getState(); return { dir: s.dir as string | null, format: s.edd?.format, beats: s.edd?.beats?.map((b: any) => ({ kind: b.base.kind, src: b.base.src, start: b.start, end: b.end })) ?? [], voice: s.edd?.audio?.voice?.src, pick: s.pick, leftTab: s.leftTab, media: s.media.length, dialog: s.dialog, status: s.status }; });

const name = `E2E Project ${Date.now().toString(36)}`;
let dir = '';
try {
	await page.goto('http://localhost:4173/', { waitUntil: 'load' });
	await page.waitForSelector('.preview-empty', { timeout: 20000 });
	ok('with no project the preview offers New project', /No project open/.test(await page.$eval('.preview-empty', (e) => (e as HTMLElement).innerText)));
	await shot('p1-empty');

	await page.click('.preview-empty .primary');
	await page.waitForSelector('.dialog');
	await page.click('.dialog label.txt input', { count: 3 });
	await page.type('.dialog label.txt input', name);
	await page.select('.dialog label.sel select', 'vertical');
	const w = await page.$eval('.dialog .row3 input', (e) => (e as HTMLInputElement).value);
	ok('the vertical preset fills in 1080 x 1920', w === '1080');
	const fileInput = await page.$('.dialog input[type=file]');
	await fileInput!.uploadFile(clip);
	await sleep(300);
	await shot('p2-dialog');
	await page.click('.dialog-foot .primary');
	await page.waitForSelector('.mcard', { timeout: 60000 });
	await sleep(1500);
	let s = await st();
	dir = s.dir ?? '';
	ok('the project was created and opened', !!dir && dir.includes('E2E-Project'), dir.split(/[\\/]/).pop());
	ok('its sequence has the chosen size and frame rate', s.format?.width === 1080 && s.format?.height === 1920 && s.format?.fps === 30, JSON.stringify(s.format));
	ok('the starting footage replaced the empty placeholder', s.beats.length === 1 && s.beats[0].kind === 'video' && Math.abs(s.beats[0].end - 3) < 0.3, JSON.stringify(s.beats));
	ok('its sound became the main audio', !!s.voice);
	ok('the Media tab is showing, with the clip in the bin', s.leftTab === 'media' && (await page.$$('.mcard')).length === 1 && !!(await page.$('.mcard .mused')));
	ok('the clip has a thumbnail', !!(await page.$('.mcard .mthumb img')));
	await shot('p3-media');

	// import another file with the bin's own file input
	const bin = await page.$('.dropzone input[type=file]');
	await bin!.uploadFile(pic);
	await page.waitForFunction(() => document.querySelectorAll('.mcard').length === 2, { timeout: 30000 });
	ok('importing a file adds it to the bin', (await page.$$('.mcard')).length === 2);

	// the image card: + Timeline appends it as a 5 s still
	await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mcard')).find((x) => /logo/.test((x as HTMLElement).innerText)) as HTMLElement; (c.querySelector('.mactions .primary') as HTMLElement).click(); });
	await sleep(1200);
	s = await st();
	ok('+ Timeline appends the image after the clip', s.beats.length === 2 && s.beats[1].kind === 'image' && Math.abs(s.beats[1].start - s.beats[0].end) < 0.01 && Math.abs(s.beats[1].end - s.beats[1].start - 5) < 0.01, JSON.stringify(s.beats));

	// the video card: Overlay arms the draw-a-box placement
	await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.mcard')).find((x) => /intro/.test((x as HTMLElement).innerText)) as HTMLElement; (Array.from(c.querySelectorAll('.mactions button')).find((b) => /Overlay/.test((b as HTMLElement).innerText)) as HTMLElement).click(); });
	await sleep(400);
	s = await st();
	ok('Overlay arms placing the clip as a video layer', s.pick?.kind === 'place' && s.pick.tile.component === 'VideoClip');
	await page.keyboard.press('Escape');

	// project settings
	await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.projbtns button')).find((x) => /Settings/.test((x as HTMLElement).innerText)) as HTMLElement; b.click(); });
	await page.waitForSelector('.dialog');
	await page.select('.dialog label.sel select', 'hd60');
	await shot('p4-settings');
	await page.click('.dialog-foot .primary');
	await sleep(1000);
	s = await st();
	ok('Project settings changes the sequence format', s.format?.width === 1920 && s.format?.height === 1080 && s.format?.fps === 60, JSON.stringify(s.format));
	ok('and the dialog closed', s.dialog === null);

	// New project again: the name must be unique
	await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.projbtns button')).find((x) => /New/.test((x as HTMLElement).innerText)) as HTMLElement; b.click(); });
	await page.waitForSelector('.dialog');
	await page.click('.dialog label.txt input', { count: 3 });
	await page.type('.dialog label.txt input', name);
	await page.click('.dialog-foot .primary');
	await page.waitForSelector('.dialog .err', { timeout: 10000 });
	ok('a duplicate project name shows a clear error', /already exists/.test(await page.$eval('.dialog .err', (e) => (e as HTMLElement).innerText)));
	await page.keyboard.press('Escape');
	await sleep(300);
	ok('Esc closes the dialog', (await st()).dialog === null);
	ok('no browser errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
	await browser.close();
	if (dir && dir.includes(`${path.sep}projects${path.sep}E2E-Project-`) && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
void readdirSync;
process.exit(failed ? 1 : 0);
