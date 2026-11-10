/**
 * The element designer: "a small animated speedometer showing 78%" → a validated ElementSpec that fits the shot.
 *
 * The model writes a SPEC (data, see engine/src/element/spec.ts), never code. Quality comes from the loop around it:
 *   context  → the look, the region's size, the footage colours under it, nearby text, numbers being said
 *   examples → the closest preset elements, as worked examples of the house style
 *   verify   → schema, expressions evaluated at several times, node budget, "something moves", rendered markup changes
 *              over time and has no NaN; failures go back to the model as a short report (twice), then to the user.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';
import { StudioProvider } from '@cls/engine/src/context';
import type { Layer } from '@cls/engine/src/edd/schema';
import { Generated } from '@cls/engine/src/element/Element';
import { PRESETS } from '@cls/engine/src/element/presets';
import { ElementSpec, checkSpec, defaultParams, type SpecIssue } from '@cls/engine/src/element/spec';
import { loadContext, norm, ocrAt } from './context';
import { BIG_MODEL, FAST_MODEL, chatJson, lastProvider } from './llm';
import { LIB } from './library';

export interface Region { x: number; y: number; w: number; h: number }
export interface DesignArgs { dir: string; brief: string; region?: Region | null; time: number; duration: number; current?: { spec: ElementSpec; params: Record<string, unknown> } | null; instruction?: string }
export interface DesignResult { ok: boolean; say: string; spec?: ElementSpec; params?: Record<string, unknown>; issues: SpecIssue[]; ms: number; attempts: number }

const ELEMENTS_DIR = path.join(LIB, 'elements');

// ------------------------------------------------------------------ saved elements
export interface Saved { id: string; name: string; description: string; tags: string[]; spec: ElementSpec; params: Record<string, unknown>; saved?: boolean }
export function listElements(): Saved[] {
	const presets: Saved[] = PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, tags: p.tags, spec: p.spec, params: defaultParams(p.spec) }));
	const mine: Saved[] = [];
	if (existsSync(ELEMENTS_DIR))
		for (const f of readdirSync(ELEMENTS_DIR).filter((x) => x.endsWith('.json'))) {
			try {
				const d = JSON.parse(readFileSync(path.join(ELEMENTS_DIR, f), 'utf8'));
				const spec = ElementSpec.parse(d.spec);
				mine.push({ id: `my-${f.replace(/\.json$/, '')}`, name: d.name ?? spec.name, description: spec.description ?? '', tags: d.tags ?? [], spec, params: d.params ?? defaultParams(spec), saved: true });
			} catch { /* a broken saved file is skipped, not fatal */ }
		}
	return [...mine, ...presets];
}
export function saveElement(name: string, spec: unknown, params: Record<string, unknown>): Saved {
	const parsed = ElementSpec.parse(spec);
	const errors = checkSpec(parsed).filter((i) => i.level === 'error');
	if (errors.length) throw new Error(`can't save: ${errors[0].message}`);
	mkdirSync(ELEMENTS_DIR, { recursive: true });
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'element';
	const tags = Array.from(new Set(norm(`${name} ${parsed.name} ${parsed.description ?? ''}`).split(' ').filter((w) => w.length > 3)));
	writeFileSync(path.join(ELEMENTS_DIR, `${slug}.json`), JSON.stringify({ name, tags, spec: parsed, params }, null, 1));
	return { id: `my-${slug}`, name, description: parsed.description ?? '', tags, spec: parsed, params, saved: true };
}

// ------------------------------------------------------------------ context about the spot
/** Average colour of the footage under the region at time t (ffmpeg grabs one frame, crops, averages). */
function footageColour(dir: string, t: number, r: Region): { hex: string; light: number } | null {
	const src = path.join(dir, 'media', 'footage.mp4');
	if (!existsSync(src)) return null;
	const crop = `crop=iw*${(r.w / 100).toFixed(4)}:ih*${(r.h / 100).toFixed(4)}:iw*${(r.x / 100).toFixed(4)}:ih*${(r.y / 100).toFixed(4)},scale=1:1`;
	const out = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', src, '-frames:v', '1', '-vf', crop, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 });
	if (out.status !== 0 || out.stdout.length < 3) return null;
	const [R, G, B] = [out.stdout[0], out.stdout[1], out.stdout[2]];
	return { hex: `#${[R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('')}`, light: (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255 };
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

function situation(a: DesignArgs) {
	const ctx = loadContext(a.dir);
	const lo = a.time - 3;
	const hi = a.time + a.duration + 2;
	const heard = ctx.words.filter((w) => w.start >= lo && w.start <= hi).map((w) => w.text).join(' ');
	const nums = [...heard.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]).concat(heard.toLowerCase().split(/\W+/).filter((w) => w in NUMBER_WORDS).map((w) => String(NUMBER_WORDS[w])));
	const r = a.region;
	const near = ocrAt(ctx, a.time + 0.5)
		.filter((e) => !r || (e.rect.x < r.x + r.w + 12 && e.rect.x + e.rect.w > r.x - 12 && e.rect.y < r.y + r.h + 12 && e.rect.y + e.rect.h > r.y - 12))
		.map((e) => e.text.replace(/\s+/g, ' ').slice(0, 50))
		.slice(0, 8);
	return { heard, nums: [...new Set(nums)].slice(0, 6), near, colour: r ? footageColour(a.dir, a.time + 0.5, r) : null };
}

// ------------------------------------------------------------------ the prompt
const DOCS = `You design a small ANIMATED VECTOR ELEMENT for a screen-recording video from a faceless tech channel. You answer with a SPEC
(data that a safe renderer draws). You never write code.

SPEC = {name, description, viewBox:[w,h], params:[...], nodes:[...]}
- viewBox: match the region's aspect ratio (given). Typical 200x200. Draw everything inside it.
- params: the settings the user will want to tweak, that YOU decide (at most 6): {key,label,type:"number"|"color"|"toggle"|"select"|"text",min,max,step,default,options}.
  Think about what this specific element needs: a speedometer has "value" and "needle time"; a flickering tube light has "flicker rate", "lowest brightness", "light colour";
  a plant has "leaves", "sway". Every param MUST be used by the nodes. number params need min, max and a default inside them.
- nodes: {type, attrs, anim, origin, repeat, show, children, text}. type is one of rect circle ellipse line path polyline polygon text group.
  attrs allowed: x y width height cx cy r rx ry x1 y1 x2 y2 d points fill stroke strokeWidth strokeLinecap strokeLinejoin strokeDasharray opacity fillOpacity strokeOpacity fontSize fontWeight fontFamily(display|body|mono) textAnchor dominantBaseline letterSpacing glow transform
  An attr value is: a number, or "=expression", or "$param", or a string with {{expression}} templates ("M {{100-r}} 50", "{{round(value)}}%", "{{$label}}" for a text param), or a colour.
  Expressions: + - * / % ^ ( ), comparisons, functions sin cos tan (DEGREES) abs min max pow sqrt floor ceil round clamp(x,a,b) mix(a,b,t) step(e,x) mod(a,b) if(cond,a,b);
  names: your param keys, i (repeat index 0..n-1), n (repeat count), t (seconds since the element appeared), pi. Booleans are 0/1.
  NO arrays, no values[i], no lists, no strings in expressions. For "three bars with different heights" make one number param per bar (bar1, bar2, bar3)
  and pick with if(i==0,bar1,if(i==1,bar2,bar3)), or derive heights from i.
  Colours: theme tokens accent accent2 text ink muted white black none, or "$colourParam", or "#hex" (only when the subject needs a real colour, like a green plant).
- anim (a list on a node): {prop, kind, from, to, period, duration, delay, phase, rate, ease}
  prop: rotate translateX translateY scale scaleX scaleY opacity draw attr:<name>   (draw reveals a stroke 0..1; attr:height animates a height; etc.)
  kind: sin (breathing/swaying, needs period), loop (repeats from to, needs period), pulse (loop that eases out), ramp (one move from to, needs duration), once, flicker (random steps, rate per second)
  ease: linear in out inout spring back.  phase is in cycles.  ALWAYS give rotate and scale nodes an origin [x,y] (their pivot).
- repeat: {count} draws the node count times (ticks, bars, arcs, leaves) using i and n.  show: expression, drawn only when non-zero.

DETAIL: a recognisable object is built from 5-12 parts, not one or two. A rocket = body, nose cone, round window, two fins, a flame (the flame is what moves).
A plant = pot, stem, 3+ leaves that sway. An explainer = the boxes/icons for each part, arrows that draw between them (appear kind draw), a label per part, and a dot or packet that travels the path. A gauge = arc, ticks, needle, hub, number. If the first idea is a single triangle or circle, add the parts that make it that thing.
FORMULAS: write every computed number as "=expression" (a leading "="), also in anim from/to/period/duration. There is NO ?: operator: use if(cond, a, b).
A repeat count draws ONE node several times (bars 0..n-1): never copy-paste the same node and repeat each copy.

BAR CHARTS: ONE repeat node, count 3. Height of bar i = if(i==0,bar1,if(i==1,bar2,bar3)) (one number param per bar) and y = baseline - that height, so every bar rises from the SAME baseline.
Animate "attr:height" with a ramp from 0 to that same expression (delay =i*0.12). Do not use min()/max() to pick a bar. Bars must differ in height and stay inside the box.

NO DEBUG TEXT: never print a setting's own value or name on the graphic ("3 parts", "speed 1.2"). Text is only for words the viewer should read: a caption the request asked for, a number the video is about (78%), a label.
LAYERING: draw back to front. Put a text label in its OWN node, never inside a group that rotates, scales or flickers, unless the text itself is meant to move
(a spinning ring with "Loading..." beside it is two nodes: the spinner, and a still text). Text params are written as "{{$key}}" in a text node.
Use "group" only to move several shapes together; give every group an origin if it rotates or scales.

STYLE (so it looks like it belongs in this video): flat, bold shapes; important shapes get a dark outline (stroke "ink", strokeWidth 3-6) with rounded caps and joins;
numbers use fontFamily "display" and are large (fontSize >= 14 in a 200-high box); at most three colours, mostly "accent" (yellow) plus white and a red "accent2" for alerts.
MOTION: it appears with an entrance in the first half second, then a subtle idle loop. Nothing is static. Prefer ease "expo" / "quart" (fast, then settles) for arrivals and "in-expo" for exits; avoid bounce/elastic/spring.
STAGED REVEALS (for explainers, "how it works", steps): give a node 'appear: {at: seconds, kind, duration?, until?}' and it is not drawn until 'at', then eases in. kind: fade | rise | pop | draw (strokes) | grow (bars from their baseline) | drop | slide-left | slide-right.
Stagger parts 0.15-0.4 s apart in the order the idea unfolds (the thing, then its arrow, then the next thing). Formulas also have ease(x) and smooth(x) giving 0..1: ease((t-1)/0.5).
3D: a node {type:"scene3d", attrs:{x,y,width,height} (its area in the viewBox; default all of it), camera:{yaw,pitch,zoom?}, objects:[...]} draws solids.
  x is right, y is UP, z toward the viewer; an object's 'at:[x,y,z]' is the centre of its BASE, so stack with y = i*height and put things on the floor at y 0.
  object shapes: box | cylinder | cone | pyramid | sphere | plane (a floor, size [w,0,d]) | line (needs 'to:[x,y,z]', 'arrow:true' for a head) | label (needs 'text', fontSize).
  object fields: size [w,h,d] (or one number), at, rotate [rx,ry,rz] degrees, color (theme word, #hex or $param), opacity, appear, repeat {count}, show. Numbers may be "=formulas" in t, i, n and your params.
  camera yaw like "=30+t*20" orbits slowly (use pitch 20-30). zoom is a multiplier (default 1 = auto-fitted: you never need to scale to fit). Use 3-8 objects, labels for names, a plane floor for grounding.
  Use a scene3d when the brief says 3D / cube / model / stack / layers / solid / orbit / depth; otherwise stay 2D. Put the dark backing plate (rect or circle, fill black) behind it as for any element.
BLENDING: you are told how light or dark the footage is under the region. On dark footage light shapes read well. On light or busy footage put a soft black backing plate
(circle or rect, fill "black", opacity 0.5) behind text and thin lines. Keep the design simple enough to read at a glance when small.
DATA: if the request or the narration gives a number for this element (78%, 4 bars), put it in the matching param's default.

ANSWER FORMAT: reply with ONE JSON object and nothing else: {"spec": { ...the SPEC... }}`;

const rank = (brief: string) => {
	const words = new Set(norm(brief).split(' '));
	return PRESETS.map((p) => ({ p, score: p.tags.filter((t) => words.has(t)).length + (words.has(norm(p.name)) ? 3 : 0) })).sort((a, b) => b.score - a.score);
};

function messagesFor(a: DesignArgs, sit: ReturnType<typeof situation>): { role: string; content: string }[] {
	const ranked = rank(`${a.brief} ${a.instruction ?? ''}`);
	const shots = [...ranked.slice(0, 2).map((r) => r.p), ...PRESETS.filter((p) => p.id === 'speedometer')].filter((p, i, arr) => arr.indexOf(p) === i).slice(0, 3);
	const r = a.region;
	const px = r ? { w: Math.round((r.w / 100) * 1920), h: Math.round((r.h / 100) * 1080) } : { w: 460, h: 460 };
	const tone = sit.colour ? `${sit.colour.light > 0.6 ? 'LIGHT' : sit.colour.light < 0.3 ? 'DARK' : 'MID-TONE'} (average ${sit.colour.hex})` : 'unknown (assume dark)';
	const examples = shots.map((p) => `EXAMPLE "${p.id}":\n${JSON.stringify(p.spec)}`).join('\n\n');
	const ctx = [
		`REGION: about ${px.w}x${px.h} px at 1080p (aspect ${(px.w / px.h).toFixed(2)}:1). Footage under it is ${tone}.`,
		sit.near.length ? `ON-SCREEN TEXT NEAR IT: ${JSON.stringify(sit.near)}` : '',
		sit.heard ? `BEING SAID: "${sit.heard.slice(0, 280)}"${sit.nums.length ? `  (numbers: ${sit.nums.join(', ')})` : ''}` : '',
		`IT IS SHOWN FOR ${a.duration.toFixed(1)} s.`,
	].filter(Boolean).join('\n');
	const task = a.current
		? `CURRENT SPEC:\n${JSON.stringify(a.current.spec)}\nCURRENT SETTINGS: ${JSON.stringify(a.current.params)}\n\nCHANGE REQUEST: ${a.instruction}\nReturn the full updated spec. Keep everything the request does not mention, and keep the existing param keys unless asked.`
		: `REQUEST: ${a.brief}`;
	return [
		{ role: 'system', content: `${DOCS}\n\nWorked examples in the house style:\n\n${examples}` },
		{ role: 'user', content: `${ctx}\n\n${task}` },
	];
}

// ------------------------------------------------------------------ verification
const layerStub = { id: 'check', component: 'Generated', props: {}, box: { x: 0, y: 0, w: 20, h: 30, rotation: 0 }, space: 'screen', z: 1, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, meta: { origin: 'ai', locked: false } } as Layer;
const motionStub = { visible: true, opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 1 };
function markup(spec: ElementSpec, params: Record<string, unknown>, t: number): string {
	return renderToStaticMarkup(React.createElement(StudioProvider, { look: 'footage-first', assetBase: '', children: React.createElement(Generated, { props: { spec, params }, layer: layerStub, motion: motionStub, frame: Math.round(t * 30), time: t, elapsed: t, length: 5 }) }));
}
/** Rough geometry from the rendered markup: where do the simple shapes sit relative to the viewBox? (paths and group transforms are ignored). */
export function outsideShare(html: string, vb: [number, number]): { total: number; outside: number } {
	let total = 0, outside = 0;
	for (const m of html.matchAll(/<(rect|circle|ellipse|line)\b([^>]*)>/g)) {
		const at = (k: string) => { const r = new RegExp(`(?:^|\\s)${k}="(-?[\\d.]+(?:e-?\\d+)?)"`).exec(m[2]); return r ? Number(r[1]) : 0; };
		let x0: number, y0: number, x1: number, y1: number;
		if (m[1] === 'rect') { x0 = at('x'); y0 = at('y'); x1 = x0 + at('width'); y1 = y0 + at('height'); }
		else if (m[1] === 'line') { x0 = Math.min(at('x1'), at('x2')); x1 = Math.max(at('x1'), at('x2')); y0 = Math.min(at('y1'), at('y2')); y1 = Math.max(at('y1'), at('y2')); }
		else { const rx = m[1] === 'circle' ? at('r') : at('rx'); const ry = m[1] === 'circle' ? at('r') : at('ry'); x0 = at('cx') - rx; x1 = at('cx') + rx; y0 = at('cy') - ry; y1 = at('cy') + ry; }
		const tr = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(/transform="([^"]*)"/.exec(m[2])?.[1] ?? '');
		if (tr) { x0 += Number(tr[1]); x1 += Number(tr[1]); y0 += Number(tr[2]); y1 += Number(tr[2]); }
		total++;
		const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
		// Out if its centre is outside, or it overhangs the box by more than a tenth of the box on any side (a backing plate may touch the edge, bars must not fall off it).
		const overhang = Math.max(-x0, x1 - vb[0]) / vb[0] > 0.1 || Math.max(-y0, y1 - vb[1]) / vb[1] > 0.1;
		if (cx < -0.05 * vb[0] || cx > 1.05 * vb[0] || cy < -0.05 * vb[1] || cy > 1.05 * vb[1] || overhang) outside++;
	}
	return { total, outside };
}

/** Does it draw, stay finite, and actually change over time? */
export function renderChecks(spec: ElementSpec, params: Record<string, unknown>): SpecIssue[] {
	const issues: SpecIssue[] = [];
	try {
		const a = markup(spec, params, 0.25);
		const b = markup(spec, params, 1.3);
		if (a.length < 120) issues.push({ level: 'error', where: 'render', message: 'it draws almost nothing (check `show` expressions and sizes)' });
		if (/NaN|undefined|Infinity/.test(a + b)) issues.push({ level: 'error', where: 'render', message: 'some value came out as NaN/undefined: an expression or attribute is wrong' });
		const geo = outsideShare(b, spec.viewBox);
		if (geo.total >= 3 && geo.outside / geo.total > 0.25) issues.push({ level: 'error', where: 'render', message: `${geo.outside} of ${geo.total} shapes sit outside the drawing box (0..${spec.viewBox[0]} wide, 0..${spec.viewBox[1]} high): recompute their x/y so everything stays inside it, bars rising from a baseline inside the box` });
		if (a === b) issues.push({ level: 'error', where: 'render', message: 'nothing changes between 0.25 s and 1.3 s: the animation has no visible effect' });
	} catch (e) {
		issues.push({ level: 'error', where: 'render', message: `could not draw it: ${e instanceof Error ? e.message.slice(0, 160) : e}` });
	}
	return issues;
}

/** Schema errors say "Invalid option" without saying what was written; show the model its own value so it can fix it. */
function gotValue(root: unknown, p: PropertyKey[]): string {
	let v: any = root;
	for (const k of p) v = v == null ? undefined : v[k as any];
	if (v === undefined) return ' (missing)';
	const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
	return ` (you wrote ${s.slice(0, 60)})`;
}

function verify(json: unknown): { spec?: ElementSpec; issues: SpecIssue[] } {
	if (!json || typeof json !== 'object') return { issues: [{ level: 'error', where: 'spec', message: 'the answer has no "spec" object' }] };
	const parsed = ElementSpec.safeParse(json);
	if (!parsed.success) return { issues: parsed.error.issues.slice(0, 6).map((i) => ({ level: 'error' as const, where: i.path.join('.'), message: `${i.message}${gotValue(json, i.path)}` })) };
	const issues = checkSpec(parsed.data);
	if (!issues.some((i) => i.level === 'error')) issues.push(...renderChecks(parsed.data, defaultParams(parsed.data)));
	return { spec: parsed.data, issues };
}

// ------------------------------------------------------------------ the loop
export async function designElement(a: DesignArgs): Promise<DesignResult> {
	const t0 = Date.now();
	const sit = situation(a);
	const messages = messagesFor(a, sit);
	let issues: SpecIssue[] = [];
	let last: { spec?: ElementSpec; say: string } = { say: '' };
	let bestValid: { spec: ElementSpec; issues: SpecIssue[]; attempt: number } | null = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		let content: string;
		try {
			// The first try uses the fast model; if it keeps failing the checks, the big model gets one go.
			content = await chatJson(messages, { schemaName: 'element', schema: {}, mode: 'json', model: attempt === 3 ? BIG_MODEL : FAST_MODEL, maxTokens: 6000, temperature: 0.35, reasoning: attempt === 3 ? { effort: 'low' } : { enabled: false }, timeoutMs: attempt === 3 ? 240000 : 90000 });
		} catch (e) {
			return { ok: false, say: `The AI model didn't answer (${e instanceof Error ? e.message.slice(0, 160) : 'error'}). Try again in a moment, or start from a preset in the gallery.`, issues, ms: Date.now() - t0, attempts: attempt };
		}
		let out: { spec?: unknown };
		try {
			out = JSON.parse(content);
		} catch {
			messages.push({ role: 'assistant', content }, { role: 'user', content: 'That was not valid JSON. Answer again with one JSON object {"spec": {...}}.' });
			continue;
		}
		const v = verify(out.spec ?? out);
		issues = v.issues;
		last = { spec: v.spec, say: '' };
		// "Too few shapes" is only a warning (a progress bar is legitimately simple), but it earns one retry before the result is accepted.
		const hard = issues.filter((i) => i.level === 'error');
		if (v.spec && !hard.length) bestValid ??= { spec: v.spec, issues, attempt };
		const errors = issues.filter((i) => i.level === 'error' || (attempt === 1 && i.where === 'nodes' && /drawn shape/.test(i.message)));
		if (v.spec && !errors.length) {
			const params = { ...defaultParams(v.spec) };
			const knobs = v.spec.params.map((p) => p.label).join(', ');
			return { ok: true, say: `Made “${v.spec.name}”${knobs ? ` with settings: ${knobs}` : ''} (${lastProvider()}).`, spec: v.spec, params, issues, ms: Date.now() - t0, attempts: attempt };
		}
		messages.push({ role: 'assistant', content }, { role: 'user', content: `The spec failed these checks:\n${errors.slice(0, 8).map((e) => `- ${e.where}: ${e.message}`).join('\n')}\nFix them and return the full corrected {"spec": {...}}.` });
	}
	if (bestValid) {
		const params = { ...defaultParams(bestValid.spec) };
		return { ok: true, say: `Made “${bestValid.spec.name}” with settings: ${bestValid.spec.params.map((p) => p.label).join(', ')} (${lastProvider()}).`, spec: bestValid.spec, params, issues: bestValid.issues, ms: Date.now() - t0, attempts: bestValid.attempt };
	}
	return { ok: false, say: `I couldn't get a working element out of that after a few tries (${issues.filter((i) => i.level === 'error')[0]?.message ?? 'unknown problem'}). Try rewording it, or start from a similar preset.`, spec: last.spec, issues, ms: Date.now() - t0, attempts: 3 };
}

void z;
