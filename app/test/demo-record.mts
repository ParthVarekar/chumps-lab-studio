// Records the README's editor demo: drives the real editor in headless Chrome, with a visible cursor and a caption per step,
// and writes docs/assets/editor-demo.{mp4,webp}. Works on a throwaway copy of a project (never the original).
//   node ../node_modules/tsx/dist/cli.mjs test/demo-record.mts [source-project]
// Needs the studio server (npm run web) and, for the "design an element" step, a model (cloud or the local one).
import puppeteer, { type Page } from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] ?? 'D:/ChumpsLabStudio/projects/raw-loop-kokoro';
const DIR = 'D:/ChumpsLabStudio/projects/_demo';
const OUT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'assets');
const FR = 'D:/ChumpsLabStudio/cache/demo-frames';
rmSync(DIR, { recursive: true, force: true });
rmSync(FR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync(FR, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const f of ['edd.json', 'words.json', 'ocr.json', 'project.json']) cpSync(`${SRC}/${f}`, `${DIR}/${f}`);
for (const d of ['media', 'analysis']) cpSync(`${SRC}/${d}`, `${DIR}/${d}`, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'], defaultViewport: { width: 1600, height: 900 } });
const page: Page = await browser.newPage();
// tsx compiles named functions inside page.evaluate with an `__name` helper the browser doesn't have.
await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
await page.goto(`http://localhost:4173/index.html?project=${encodeURIComponent(DIR)}`, { waitUntil: 'load' });
await page.waitForSelector('.clip', { timeout: 30000 });
await sleep(3000);

// ---- a visible cursor, a click ring and a caption pill (headless screenshots have no cursor)
await page.evaluate(() => {
	const st = document.createElement('style');
	st.textContent = `
	#democursor{position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;transform:translate(-4px,-3px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}
	.demoring{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #FFD60A;animation:dr .5s ease-out forwards}
	@keyframes dr{to{transform:scale(3.2);opacity:0}}
	#democap{position:fixed;top:5px;left:50%;transform:translateX(-50%);z-index:2147483645;pointer-events:none;background:#FFD60A;color:#111;
	  font:700 17px/1 Inter,system-ui,sans-serif;padding:8px 18px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.45);white-space:nowrap;transition:opacity .25s}
	#democap b{display:inline-block;background:#111;color:#FFD60A;border-radius:999px;padding:2px 8px;margin-right:8px;font-size:14px}`;
	document.head.appendChild(st);
	const c = document.createElement('div');
	c.id = 'democursor';
	c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l6.8 18 2.3-7.4 7.4-2.4z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
	document.body.appendChild(c);
	const cap = document.createElement('div');
	cap.id = 'democap';
	cap.style.opacity = '0';
	document.body.appendChild(cap);
	const move = (e: PointerEvent | MouseEvent) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; };
	window.addEventListener('pointermove', move, true);
	window.addEventListener('mousemove', move, true);
	window.addEventListener('pointerdown', (e) => { const r = document.createElement('div'); r.className = 'demoring'; r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
});
const caption = (n: number, text: string) => page.evaluate((n, t) => { const c = document.getElementById('democap')!; c.innerHTML = n ? `<b>${n}</b>${t}` : t; c.style.opacity = t ? '1' : '0'; }, n, text);

// ---- screen recording through the DevTools screencast (frames arrive when the page repaints)
const cdp = await page.createCDPSession();
const frames: { file: string; t: number; cut?: boolean }[] = [];
let recording = false;
let cutNext = false;
let n = 0;
cdp.on('Page.screencastFrame', (f: any) => {
	void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
	if (!recording) return;
	const file = `${FR}/f${String(n++).padStart(5, '0')}.jpg`;
	writeFileSync(file, Buffer.from(f.data, 'base64'));
	frames.push({ file, t: f.metadata.timestamp, cut: cutNext });
	cutNext = false;
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
const pause = () => { recording = false; };
const resume = () => { cutNext = true; recording = true; };

// ---- input helpers: smooth, eased cursor travel
let mx = 800, my = 450;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
async function moveTo(x: number, y: number, ms = 450) {
	const steps = Math.max(6, Math.round(ms / 16));
	const [x0, y0] = [mx, my];
	for (let i = 1; i <= steps; i++) {
		const u = ease(i / steps);
		await page.mouse.move(x0 + (x - x0) * u, y0 + (y - y0) * u);
		await sleep(14);
	}
	[mx, my] = [x, y];
}
const rectOf = (sel: string, text?: string) => page.evaluate((sel, text) => {
	const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
	const label = (e: HTMLElement) => ((e.querySelector('b') as HTMLElement | null)?.innerText ?? e.innerText).trim();
	const el = text ? els.find((e) => label(e).startsWith(text) || e.title === text) : els[0];
	if (!el) return null;
	el.scrollIntoView({ block: 'nearest' });
	const r = el.getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height };
}, sel, text);
async function click(sel: string, text?: string, ms = 450) {
	const r = await rectOf(sel, text);
	if (!r) throw new Error(`not found: ${sel} ${text ?? ''}`);
	await moveTo(r.x + r.w / 2, r.y + r.h / 2, ms);
	await page.mouse.down();
	await sleep(60);
	await page.mouse.up();
	await sleep(350);
}
const stage = async () => (await rectOf('.overlay'))!;
async function drag(a: [number, number], b: [number, number], ms = 700) {
	const s = await stage();
	const P = (p: [number, number]) => [s.x + (s.w * p[0]) / 100, s.y + (s.h * p[1]) / 100] as const;
	const [ax, ay] = P(a), [bx, by] = P(b);
	await moveTo(ax, ay);
	await page.mouse.down();
	await moveTo(bx, by, ms);
	await sleep(120);
	await page.mouse.up();
	await sleep(500);
}
const seek = (t: number) => page.evaluate((t) => (window as any).__studio.getState().seekTo(t), t);
const play = async (seconds: number) => { await click('.transport button.primary.round', undefined, 300); await sleep(seconds * 1000); await click('.transport button.primary.round', undefined, 250); };
const rail = (label: string) => click('.rail button', label, 400);
// A clean still for the README gallery: no cursor, no caption.
async function snap(name: string) {
	await page.evaluate(() => { for (const id of ['democursor', 'democap']) (document.getElementById(id) as HTMLElement).style.visibility = 'hidden'; });
	const was = recording;
	recording = false;
	await sleep(150);
	await page.screenshot({ path: `${OUT}/${name}.jpg` as `${string}.jpg`, type: 'jpeg', quality: 90 });
	await page.evaluate(() => { for (const id of ['democursor', 'democap']) (document.getElementById(id) as HTMLElement).style.visibility = ''; });
	recording = was;
}

// =================================================================== the storyboard
await seek(9.0);
await sleep(1500);
resume();
await caption(0, 'Chumps Lab Studio · the AI already edited this raw screen recording');
await sleep(900);
await play(5.2);
await seek(11.6);
await sleep(1200);
await snap('shot-editor');

await caption(1, 'Draw a box on the picture and it zooms there');
await seek(5.0);
await sleep(700);
await rail('Effects');
await click('.tile', 'Zoom');
await drag([22, 44], [62, 74], 800);
await seek(4.9);
await sleep(400);
await play(3.2);

await caption(2, 'Effects: click a tile, then draw where it goes');
await seek(14.6);
await sleep(700);
await rail('Effects');
await click('.tile', 'Highlight box');
await drag([26.2, 15.8], [38.4, 22.4], 700);
await click('.tile', 'Arrow');
await drag([48, 36], [37.5, 21.5], 700);
await seek(15.4);
await sleep(900);
await snap('shot-effects');
await seek(14.55);
await sleep(300);
await play(2.4);

await caption(3, 'Transitions and karaoke captions, one click each');
await rail('Transitions');
await seek(13.05);
await sleep(400);
await click('.tile', 'Colour wipe');
await rail('Captions');
await seek(10.0);
await sleep(400);
await click('.chips button', 'Next 10');
await click('.tile', 'Karaoke');
await seek(12.3);
await sleep(300);
await play(3.4);

await caption(4, 'Animated elements, each with its own settings');
await rail('Elements');
await seek(15.8);
await sleep(500);
for (const name of ['Wi-Fi', 'Waving plant', 'Battery']) {
	const r = await rectOf('.tile.elem', name);
	if (r) { await moveTo(r.x + r.w / 2, r.y + r.h / 2, 380); await sleep(700); }
}
await click('.tile.elem', 'Speedometer');
await drag([74, 12], [94, 47], 700);
await click('.side .tabs button', 'Inspector', 400);
await sleep(500);
{
	const r = await rectOf('.inspector .slider input[type=range]');
	if (r) {
		await moveTo(r.x + r.w * 0.78, r.y + r.h / 2, 500);
		await page.mouse.down();
		await moveTo(r.x + r.w * 0.3, r.y + r.h / 2, 700);
		await moveTo(r.x + r.w * 0.95, r.y + r.h / 2, 700);
		await page.mouse.up();
		await sleep(600);
	}
}
await seek(17.0);
await sleep(900);
await snap('shot-elements');
await seek(15.7);
await sleep(300);
await play(2.6);

await caption(5, 'Or describe a new element: the AI designs it to fit the shot');
await seek(16.2);
await sleep(500);
await click('.designer textarea', undefined, 450);
await page.keyboard.type('a pulsing wifi signal', { delay: 55 });
await click('.designrow button', undefined, 400);
await drag([46, 40], [64, 78], 700);
await click('.designer button.primary', undefined, 450);
await sleep(1200);
await caption(5, 'Designing it on the local model…  (wait cut)');
await sleep(1000);
pause();
await page.waitForSelector('.draftbar', { timeout: 300000 }).catch(() => undefined);
await sleep(800);
resume();
await caption(5, 'A draft first: Apply or Discard');
await sleep(1600);
if (await page.$('.draftbar button.primary')) await click('.draftbar button.primary', undefined, 450);
await seek(16.1);
await sleep(300);
await play(2.6);

await caption(6, 'Or just ask the assistant');
await click('.side .tabs button', 'Assistant', 400);
await click('.composer textarea', undefined, 400);
await page.keyboard.type('zoom 1:04 "Test Condition"', { delay: 45 });
await page.keyboard.press('Enter');
await page.waitForSelector('.decide .primary', { timeout: 20000 }).catch(() => undefined);
await sleep(1400);
await snap('shot-assistant');
await click('.decide .primary', undefined, 450);
await sleep(600);
await seek(63.8);
await sleep(400);
await play(3.4);
await caption(0, 'Everything stays editable: undo, lock, retime, re-plan');
await sleep(2200);
pause();
await cdp.send('Page.stopScreencast');
await browser.close();
rmSync(DIR, { recursive: true, force: true });

// =================================================================== frames → mp4 + animated webp
let list = '';
for (let i = 0; i < frames.length; i++) {
	const next = frames[i + 1];
	let d = next ? next.t - frames[i].t : 1.5;
	if (next?.cut) d = 0.35; // a pause in recording (the model was thinking): don't hold the frame
	d = Math.min(Math.max(d, 1 / 60), 2.5);
	list += `file '${frames[i].file}'\nduration ${d.toFixed(4)}\n`;
}
list += `file '${frames[frames.length - 1].file}'\n`;
writeFileSync(`${FR}/list.txt`, list);
const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed'); };
ff(['-f', 'concat', '-safe', '0', '-i', `${FR}/list.txt`, '-vf', 'fps=30,scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/editor-demo.mp4`]);
ff(['-i', `${OUT}/editor-demo.mp4`, '-vf', 'fps=12,scale=1100:-2:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '62', '-compression_level', '6', '-loop', '0', `${OUT}/editor-demo.webp`]);
console.log(`${frames.length} frames → ${OUT}/editor-demo.mp4 and .webp`);
process.exit(0);
