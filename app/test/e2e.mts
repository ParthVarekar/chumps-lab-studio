// End-to-end test of the editor in a real browser, on a COPY of a project (never the original).
//   node ../node_modules/tsx/dist/cli.mjs test/e2e.mts [--shots dir]
// Needs the server running (npm run serve). Exits non-zero if any check fails.
import puppeteer, { type Page } from 'puppeteer-core';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const SRC = 'D:/ChumpsLabStudio/projects/raw-loop-kokoro';
const DIR = 'D:/ChumpsLabStudio/projects/_e2e';
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
for (const f of ['edd.json', 'words.json', 'ocr.json', 'project.json']) cpSync(`${SRC}/${f}`, `${DIR}/${f}`);
for (const d of ['media', 'analysis']) cpSync(`${SRC}/${d}`, `${DIR}/${d}`, { recursive: true });

const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const api = async (p: string, b?: unknown) => (await fetch(`http://localhost:4173${p}`, { method: b ? 'POST' : 'GET', headers: H, body: b ? JSON.stringify(b) : undefined })).json() as Promise<any>;
const doc = async () => (await api('/api/open', { dir: DIR })).edd;
const count = (edd: any) => ({
	layers: edd.beats.reduce((n: number, b: any) => n + b.layers.filter((l: any) => !/^continues/.test(l.meta?.reason ?? '')).length, 0),
	cams: edd.beats.reduce((n: number, b: any) => n + b.camera.length, 0),
	sfx: edd.audio.sfx.length,
});

const tStartAfter = (e: any) => { const x = e.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((y: any) => y.l.props.text === 'Hello editor'); return x.b.start + x.l.enter.at; };
let failed = 0;
const ok = (name: string, cond: unknown, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 950 } });
const page: Page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
page.on('requestfailed', (r) => { if (!/aborted/i.test(r.failure()?.errorText ?? '')) errors.push(`request failed: ${r.url().slice(0, 90)} (${r.failure()?.errorText})`); });
const shot = async (n: string) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${n}.png` as `${string}.png` }); } };
const click = async (sel: string) => { await page.waitForSelector(sel, { timeout: 8000 }); await page.click(sel); await sleep(500); };
const text = (sel: string) => page.$eval(sel, (e) => (e as HTMLElement).innerText).catch(() => '');

await page.goto(`http://localhost:4173/index.html?project=${encodeURIComponent(DIR)}`, { waitUntil: 'load' });
await page.waitForSelector('.clip', { timeout: 20000 });
await sleep(3000);
const base = count(await doc());
ok('project opens with timeline clips', (await page.$$('.clip')).length > 5, `${(await page.$$('.clip')).length} clips`);
await shot('1-open');

// 1. Library: add a title at the playhead
// The Title tile is a "point" tile: click it, then click where it should go on the picture.
await page.evaluate(() => (Array.from(document.querySelectorAll('.tile')).find((e) => /^Title/.test((e as HTMLElement).innerText)) as HTMLElement).click());
await sleep(500);
const stageBox = await page.$eval('.stage', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(stageBox.x + stageBox.w * 0.5, stageBox.y + stageBox.h * 0.3);
await sleep(900);
let d = await doc();
ok('Add > Title creates a layer', count(d).layers === base.layers + 1);
ok('new item is selected and shown in the inspector', /Title/.test(await text('.inspector')), (await text('.ihead')).replace(/\n/g, ' '));

// 2. Inspector: edit the text prop
const textInput = await page.$('.inspector .txt input');
await textInput!.click({ count: 3 });
await textInput!.type('Hello editor');
await page.keyboard.press('Enter');
await sleep(800);
d = await doc();
ok('Inspector edits content', JSON.stringify(d).includes('Hello editor'));

// 3. Inspector: numeric start
const startBox = await page.$('.inspector .row3 .num input');
await startBox!.click({ count: 3 });
await startBox!.type('30');
await page.keyboard.press('Enter');
await sleep(800);
const seg = d.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.props.text === 'Hello editor');
const d2 = await doc();
const seg2 = d2.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.props.text === 'Hello editor');
ok('typing a start time moves the item', seg && seg2 && Math.abs(seg2.b.start + seg2.l.enter.at - 30) < 0.2, `${(seg.b.start + seg.l.enter.at).toFixed(1)} → ${(seg2.b.start + seg2.l.enter.at).toFixed(1)} s`);

// 4. Timeline drag
const clipBox = await page.evaluate(() => {
	const els = Array.from(document.querySelectorAll('.timeline-editor-action')) as HTMLElement[];
	const el = els.find((e) => e.innerText.includes('Hello editor')) ?? els[0];
	el.scrollIntoView({ block: 'nearest', inline: 'center' });
	const r = el.getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await sleep(500);
const before = await doc();
const bStart = before.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.props.text === 'Hello editor');
const cb = await page.evaluate(() => {
	const el = Array.from(document.querySelectorAll('.timeline-editor-action')).find((e) => (e as HTMLElement).innerText.includes('Hello editor')) as HTMLElement;
	const r = el.getBoundingClientRect();
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(cb.x, cb.y);
await page.mouse.down();
await page.mouse.move(cb.x + 60, cb.y, { steps: 8 });
await page.mouse.up();
await sleep(1000);
const after = await doc();
const aStart = after.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.props.text === 'Hello editor');
ok('dragging a clip on the timeline retimes it', aStart && Math.abs((aStart.b.start + aStart.l.enter.at) - (bStart.b.start + bStart.l.enter.at) - 1) < 0.45, `${(bStart.b.start + bStart.l.enter.at).toFixed(2)} → ${(aStart.b.start + aStart.l.enter.at).toFixed(2)} s (60 px)`);
await shot('2-after-drag');

// 5. Keyboard: seek, split, undo/redo, delete
await page.keyboard.down('Shift');
await page.keyboard.press('ArrowRight');
await page.keyboard.up('Shift');
await sleep(500);
const t1 = await text('.timecode');
ok('Shift+→ moves the playhead one second', /^0:01\.0 /.test(t1), t1);

// 6. Preview handles: select the title while it is on screen and drag its handle
const titleId = after.beats.flatMap((b: any) => b.layers).find((l: any) => l.props.text === 'Hello editor').id;
await page.evaluate((id, t) => { const st = (window as any).__studio.getState(); st.select([id]); st.seekTo(t); }, titleId, tStartAfter(after) + 0.9);
await sleep(1500);
const h0 = await page.$eval('.handle', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, idle: e.classList.contains('idle') }; }).catch(() => null);
ok('selected title shows live handles on the preview', !!h0 && !h0.idle);
if (h0 && !h0.idle) {
	const boxBefore = (await doc()).beats.flatMap((b: any) => b.layers).find((l: any) => l.id === titleId).box;
	await page.mouse.move(h0.x + h0.w / 2, h0.y + h0.h / 2);
	await page.mouse.down();
	await page.mouse.move(h0.x + h0.w / 2 + 90, h0.y + h0.h / 2 + 40, { steps: 8 });
	await page.mouse.up();
	await sleep(1000);
	const boxAfter = (await doc()).beats.flatMap((b: any) => b.layers).find((l: any) => l.id === titleId).box;
	ok('dragging the handle on the preview moves the graphic', boxAfter.x > boxBefore.x + 3 && boxAfter.y > boxBefore.y + 2, `x ${boxBefore.x} → ${boxAfter.x}, y ${boxBefore.y} → ${boxAfter.y}`);
	await shot('2b-after-handle-drag');
}

// 7. Assistant
await click('.side .tabs button:nth-child(2)');
const msgsBefore = (await page.$$('.msg')).length;
await page.type('.composer textarea', 'zoom 1:04 "Test Condition"');
await page.keyboard.press('Enter');
await page.waitForSelector('.decide .primary', { timeout: 15000 }).catch(() => undefined);
await sleep(600);
ok('assistant answers a typed shortcut with a previewable change', (await page.$$('.msg')).length > msgsBefore && !!(await page.$('.decide .primary')), (await text('.msg.ai .bubble')).slice(0, 80));
ok('preview shows the AI draft badge and ghost clip', !!(await page.$('.draftbar')) && !!(await page.$('.clip.ghost')));
await shot('3-draft');
const pre = count(await doc());
await page.click('.decide .primary');
await sleep(1200);
const post = count(await doc());
ok('Apply commits the draft (a zoom is added)', post.cams === pre.cams + 1, `${pre.cams} → ${post.cams} zooms`);
ok('draft preview is gone after applying', !(await page.$('.draftbar')));

// 8. Undo / redo through the UI
await page.keyboard.press('Escape');
await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await sleep(1200);
ok('Ctrl+Z undoes the applied change', count(await doc()).cams === pre.cams);

// 9. AI model path (natural language): a proposal, or a sensible question. The cloud model may be out of quota; the local one then answers.
const msgs2 = (await page.$$('.msg')).length;
await page.type('.composer textarea', 'put a skull sticker where I say nightmare');
await page.keyboard.press('Enter');
await page.waitForFunction((n) => document.querySelectorAll('.msg.ai').length > n && !document.querySelector('.typing'), { timeout: 240000 }, (await page.$$('.msg.ai')).length).catch(() => undefined);
await sleep(600);
const answered = (await page.$$('.msg')).length > msgs2 + 1;
ok('assistant (AI model) answers a plain-English request', answered, (await text('.msg.ai:last-of-type .bubble')).slice(0, 90).replace(/\n/g, ' '));
await shot('4-model-draft');
if (await page.$('.decide .primary')) {
	const stickersBefore = JSON.stringify(await doc()).split('MemeSticker').length;
	await page.evaluate(() => (document.querySelectorAll('.decide button')[1] as HTMLElement)?.click());
	await sleep(500);
	ok('Discard leaves the edit untouched', JSON.stringify(await doc()).split('MemeSticker').length === stickersBefore && !(await page.$('.draftbar')));
}

// 9b. Effects: click a tile, then draw a box on the preview
const railTo = async (label: string) => { await page.evaluate((l) => (Array.from(document.querySelectorAll('.rail button')).find((b) => (b as HTMLElement).title === l) as HTMLElement).click(), label); await sleep(500); };
const comps = async () => (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => !/^continues/.test(l.meta?.reason ?? '')).map((l: any) => l.component);
await page.evaluate(() => (window as any).__studio.getState().seekTo(40));
await sleep(900);
await railTo('Effects');
const nHl = (await comps()).filter((c: string) => c === 'Highlight').length;
await page.evaluate(() => (Array.from(document.querySelectorAll('.tile')).find((b) => (b as HTMLElement).innerText.includes('Highlight box')) as HTMLElement).click());
await sleep(400);
ok('clicking an effect tile arms drawing on the preview', !!(await page.$('.overlay.picking')));
const ov = await page.$eval('.overlay', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(ov.x + ov.w * 0.3, ov.y + ov.h * 0.4);
await page.mouse.down();
await page.mouse.move(ov.x + ov.w * 0.55, ov.y + ov.h * 0.6, { steps: 6 });
await page.mouse.up();
await sleep(1000);
const hl = (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.component === 'Highlight');
ok('drawing a box places the highlight exactly there', hl.length === nHl + 1 && Math.abs(hl[hl.length - 1].box.x - 30) < 3 && Math.abs(hl[hl.length - 1].box.w - 25) < 3, JSON.stringify(hl[hl.length - 1]?.box));
await shot('6-effect-drawn');

// 9c. Drag a tile onto the picture
const nSpot = (await comps()).filter((c: string) => c === 'Spotlight').length;
await page.evaluate(() => {
	const tile = Array.from(document.querySelectorAll('.tile')).find((b) => (b as HTMLElement).innerText.includes('Spotlight')) as HTMLElement;
	const dt = new DataTransfer();
	tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
	const o = document.querySelector('.overlay') as HTMLElement;
	const r = o.getBoundingClientRect();
	const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + r.width * 0.5, clientY: r.y + r.height * 0.5 };
	o.dispatchEvent(new DragEvent('dragover', opts));
	o.dispatchEvent(new DragEvent('drop', opts));
});
await sleep(1000);
ok('dragging a tile onto the preview drops it under the pointer', (await comps()).filter((c: string) => c === 'Spotlight').length === nSpot + 1);

// 9d. Transitions: one click, centred on the playhead
await railTo('Transitions');
await page.evaluate(() => (window as any).__studio.getState().seekTo(50));
await sleep(700);
const nFlash = (await comps()).filter((c: string) => c === 'Flash').length;
await page.evaluate(() => (Array.from(document.querySelectorAll('.tile')).find((b) => (b as HTMLElement).innerText.includes('Flash')) as HTMLElement).click());
await sleep(900);
const fl = (await doc()).beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).filter((x: any) => x.l.component === 'Flash');
ok('a transition tile adds one effect centred on the playhead', fl.length === nFlash + 1 && Math.abs(fl[fl.length - 1].b.start + fl[fl.length - 1].l.enter.at - 49.85) < 0.3);

// 9e. Captions from the transcript
await railTo('Captions');
const nCap = (await comps()).filter((c: string) => c === 'Captions').length;
await page.evaluate(() => { (Array.from(document.querySelectorAll('.chips button')).find((b) => (b as HTMLElement).innerText.includes('Next 10')) as HTMLElement).click(); });
await page.evaluate(() => (Array.from(document.querySelectorAll('.tile')).find((b) => (b as HTMLElement).innerText.includes('Pop words')) as HTMLElement).click());
await sleep(1000);
const cap = (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.component === 'Captions');
ok('captions are built from the transcript for the chosen range', cap.length >= 1 && (await comps()).filter((c: string) => c === 'Captions').length === nCap + 1 && cap[cap.length - 1].props.words.length >= 5, `${cap[cap.length - 1]?.props.words.length} words`);

// 9f. Elements: gallery, drop one in, its settings appear in the inspector and change the drawing
await railTo('Elements');
ok('the elements gallery shows animated thumbnails', (await page.$$('.ethumb svg')).length >= 12);
await page.evaluate(() => (window as any).__studio.getState().seekTo(55));
await sleep(700);
await page.evaluate(() => {
	const tile = Array.from(document.querySelectorAll('.tile.elem')).find((b) => (b as HTMLElement).innerText.includes('Speedometer')) as HTMLElement;
	const dt = new DataTransfer();
	tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
	const o = document.querySelector('.overlay') as HTMLElement;
	const r = o.getBoundingClientRect();
	const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + r.width * 0.7, clientY: r.y + r.height * 0.4 };
	o.dispatchEvent(new DragEvent('dragover', opts));
	o.dispatchEvent(new DragEvent('drop', opts));
});
await sleep(1200);
const gen = (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.component === 'Generated' && !/^continues/.test(l.meta?.reason ?? ''));
ok('dropping an element puts it on the picture', gen.length === 1 && gen[0].space === 'stage');
await page.click('.side .tabs button:nth-child(1)');
await sleep(500);
ok('the element has its own settings in the inspector', (await page.$$('.inspector .slider')).length >= 2, (await text('.inspector')).slice(0, 90).replace(/\n/g, ' '));
await page.evaluate(() => { const r = document.querySelector('.inspector .slider input[type=range]') as HTMLInputElement; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(r, '33'); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
await sleep(1000);
const gen2 = (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.component === 'Generated' && !/^continues/.test(l.meta?.reason ?? ''));
ok('changing a setting changes the element', Number(gen2[0].props.params?.value) === 33, JSON.stringify(gen2[0].props.params));
await shot('7-element');

// 9g. Groups: one gesture makes a zoom + spotlight that stay linked
await railTo('Effects');
await page.evaluate(() => (window as any).__studio.getState().seekTo(70));
await sleep(700);
const camsBefore = count(await doc()).cams;
await page.evaluate(() => (Array.from(document.querySelectorAll('.tile')).find((b) => (b as HTMLElement).innerText.includes('Zoom + spotlight')) as HTMLElement).click());
await sleep(300);
const ov2 = await page.$eval('.overlay', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(ov2.x + ov2.w * 0.3, ov2.y + ov2.h * 0.3);
await page.mouse.down();
await page.mouse.move(ov2.x + ov2.w * 0.6, ov2.y + ov2.h * 0.6, { steps: 8 });
await page.mouse.up();
await sleep(1200);
const dG = await doc();
const grouped = dG.beats.flatMap((b: any) => [...b.layers, ...b.camera].filter((x: any) => x.meta?.group));
ok('Zoom + spotlight creates a zoom and a spotlight sharing one group', count(dG).cams === camsBefore + 1 && new Set(grouped.map((x: any) => x.meta.group)).size === 1 && grouped.length >= 2, `${grouped.length} linked items`);
const camG = dG.beats.flatMap((b: any) => b.camera.map((c: any, i: number) => ({ b, c, id: `${b.id}cam${i + 1}` }))).find((x: any) => x.c.meta.group);
const spotBefore = dG.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.meta.group && x.l.component === 'Spotlight');
await api('/api/ops', { dir: DIR, author: 'user', ops: [{ op: 'set_time', id: camG.id, start: camG.b.start + camG.c.at + 5 }] });
const spotAfter = (await doc()).beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.meta.group && x.l.component === 'Spotlight');
ok('moving the zoom moves its spotlight by the same amount', spotAfter && Math.abs((spotAfter.b.start + spotAfter.l.enter.at) - (spotBefore.b.start + spotBefore.l.enter.at) - 5) < 0.1);
await shot('8-grouped');

// 9h. Keyboard: copy / paste at the playhead, nudge
await page.evaluate((id) => { (document.activeElement as HTMLElement)?.blur(); (window as any).__studio.getState().select([id]); }, titleId);
await sleep(300);
const layersBefore = count(await doc()).layers;
await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control');
await page.evaluate(() => (window as any).__studio.getState().seekTo(100));
await sleep(500);
await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control');
await sleep(1000);
const dP = await doc();
const pasted = dP.beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).filter((x: any) => x.l.props.text === 'Hello editor' && Math.abs(x.b.start + x.l.enter.at - 100) < 0.2);
ok('Ctrl+C then Ctrl+V pastes a copy at the playhead', count(dP).layers === layersBefore + 1 && pasted.length === 1);
await page.evaluate((id) => (window as any).__studio.getState().select([id]), pasted[0].l.id);
await sleep(300);
await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
await sleep(900);
const nudged = (await doc()).beats.flatMap((b: any) => b.layers.map((l: any) => ({ b, l }))).find((x: any) => x.l.id === pasted[0].l.id);
ok('Alt+Shift+→ nudges the selection by one second', nudged && Math.abs(nudged.b.start + nudged.l.enter.at - 101) < 0.2);

// 9i. Disable / enable with E: the item stays, but is switched off
await page.keyboard.press('e');
await sleep(900);
const offItem = (await doc()).beats.flatMap((b: any) => b.layers).find((l: any) => l.id === pasted[0].l.id);
ok('E switches the selected item off (kept in the edit)', offItem?.meta?.disabled === true && (await page.$$('.clip.off')).length >= 1);
await page.keyboard.press('e');
await sleep(900);
ok('E again switches it back on', !(await doc()).beats.flatMap((b: any) => b.layers).find((l: any) => l.id === pasted[0].l.id)?.meta?.disabled);

// 9j. Markers: M drops one at the playhead, Ctrl+→ jumps to the next, Shift+M removes
await page.evaluate(() => (window as any).__studio.getState().seekTo(30));
await sleep(500);
await page.keyboard.press('m');
await sleep(800);
await page.evaluate(() => (window as any).__studio.getState().seekTo(10));
await sleep(500);
await page.keyboard.down('Control'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Control');
await sleep(600);
const mkDoc = (await doc()).markers;
const tNow = await page.evaluate(() => (window as any).__studio.getState().time);
ok('M adds a marker at the playhead and it shows on the timeline', mkDoc.length === 1 && Math.abs(mkDoc[0].at - 30) < 0.1 && (await page.$$('.clip-marker')).length === 1);
ok('Ctrl+→ jumps to the next marker', Math.abs(tNow - 30) < 0.1, `${tNow} s`);
await page.keyboard.down('Shift'); await page.keyboard.press('m'); await page.keyboard.up('Shift');
await sleep(800);
ok('Shift+M removes the marker under the playhead', (await doc()).markers.length === 0);

// 9k. Lane mute: clicking a lane's name switches the whole lane off, and back on
await page.evaluate(() => { const l = Array.from(document.querySelectorAll('.tl-label.mutable')).find((e) => (e as HTMLElement).innerText.startsWith('Overlay 1')) as HTMLElement; l.click(); });
await sleep(1000);
const laneOff = (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.meta.disabled).length;
ok('clicking a lane name switches every item in it off', laneOff >= 2 && (await page.$$('.tl-label.muted')).length === 1, `${laneOff} items off`);
await page.evaluate(() => { const l = document.querySelector('.tl-label.muted') as HTMLElement; l.click(); });
await sleep(1000);
ok('clicking it again switches them back on', (await doc()).beats.flatMap((b: any) => b.layers).filter((l: any) => l.meta.disabled).length === 0);

// 10. Another client (the AI via the API) changes the doc: the open editor updates live
const rev0 = (await api('/api/open', { dir: DIR })).rev;
const before2 = (await page.$$('.clip')).length;
await api('/api/ops', { dir: DIR, author: 'ai', ops: [{ op: 'add_layer', component: 'KineticWord', at: 90, props: { text: 'LIVE' }, why: 'api test' }] });
await sleep(1500);
ok('an edit made through the API appears live in the open editor', (await page.$$('.clip')).length === before2 + 1, `rev ${rev0}`);
await shot('5-live');

ok('no browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
rmSync(DIR, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
void existsSync;
