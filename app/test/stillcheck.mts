// Make a tiny project with a blur + captions + generated element, then render stills through the real renderer.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PRESETS } from '../../engine/src/element/presets';
const SRC = 'D:/ChumpsLabStudio/projects/edit-demo';
const DIR = 'D:/ChumpsLabStudio/projects/_still';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
for (const f of ['words.json', 'ocr.json', 'project.json']) cpSync(`${SRC}/${f}`, `${DIR}/${f}`);
for (const d of ['media', 'analysis']) cpSync(`${SRC}/${d}`, `${DIR}/${d}`, { recursive: true });
const edd = JSON.parse(readFileSync(`${SRC}/edd.json`, 'utf8'));
for (const b of edd.beats) { b.layers = []; b.camera = []; b.moods = []; }
edd.audio.sfx = [];
writeFileSync(`${DIR}/edd.json`, JSON.stringify(edd));
const words = JSON.parse(readFileSync(`${SRC}/words.json`, 'utf8')).words.filter((w: { start: number }) => w.start >= 61 && w.start <= 72).map((w: { text: string; start: number; end: number }) => ({ text: w.text, start: w.start, end: w.end }));
const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const api = async (p: string, b: unknown) => (await fetch(`http://localhost:4173${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json() as Promise<any>;
await api('/api/open', { dir: DIR });
const r = await api('/api/ops', { dir: DIR, author: 'user', ops: [
	{ op: 'add_layer', component: 'BlurRegion', at: 62, until: 66, props: { mode: 'blur', amount: 30 }, box: { x: 20, y: 36, w: 50, h: 30 } },
	{ op: 'add_layer', component: 'Captions', at: 62, until: 72, props: { words, style: 'pop' } },
	{ op: 'add_layer', component: 'Generated', at: 62, until: 70, props: { spec: PRESETS.find((p) => p.id === 'speedometer')!.spec, params: { value: 88, label: 'CPU' } }, box: { x: 72, y: 14, w: 20, h: 35.5 } },
] });
console.log(r.notes.map((n: any) => n.message));
