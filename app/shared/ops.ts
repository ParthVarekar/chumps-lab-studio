/**
 * The editor's command layer. EVERYTHING that changes an edit goes through `applyOps`: a click in the UI, a drag on
 * the canvas, a typed shortcut, a chat message to the AI. Because it is plain data in and plain data out, the AI
 * drives the editor with exactly the same commands a person does, and every change can be previewed (dry run),
 * recorded (history), undone and replayed.
 *
 * Times are GLOBAL seconds. Layers physically live inside beats (a beat is a render-cache chunk), so this layer
 * hides that: moving a layer across a beat boundary re-homes it; making one longer than its beat splits it into
 * continuation segments. Callers never think about beats.
 */
import { z } from 'zod';
import { Edd, EnterPreset, ExitPreset, Direction, MoodKind, type Beat, type Layer, type SfxClip } from '@cls/engine/src/edd/schema';

// ------------------------------------------------------------------ ops

const Box = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), rotation: z.number().optional() });
const Id = z.string().describe('an item id, e.g. "b4v2", "b4cam1", "mood-b9-0", "sfx12"');

export const Op = z.discriminatedUnion('op', [
	z.object({
		op: z.literal('add_layer'),
		component: z.string().describe('Title, KineticWord, Header, PopImage, MemeSticker, UILabel, ColorChip, …'),
		at: z.number().describe('global start, seconds'),
		until: z.number().optional().describe('global end, seconds (default: component-specific)'),
		props: z.record(z.string(), z.unknown()).default({}),
		box: Box.optional(),
		space: z.enum(['screen', 'stage']).optional(),
		enter: z.object({ preset: EnterPreset, direction: Direction.optional(), durationFrames: z.number().int().optional() }).optional(),
		why: z.string().optional(),
		group: z.string().optional().describe('link tag; items with the same tag move, copy, lock and delete together (e.g. a zoom and the spotlight on it)'),
	}),
	z.object({
		op: z.literal('add_zoom'),
		at: z.number(),
		until: z.number().describe('global time the zoom starts going back out'),
		to: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe('region of the frame to fill the screen, % of frame'),
		why: z.string().optional(),
		group: z.string().optional().describe('link tag; items with the same tag move, copy, lock and delete together (e.g. a zoom and the spotlight on it)'),
	}),
	z.object({ op: z.literal('add_mood'), kind: MoodKind, at: z.number(), duration: z.number().default(1.2), why: z.string().optional(), group: z.string().optional().describe('link tag; items with the same tag move, copy, lock and delete together (e.g. a zoom and the spotlight on it)'), }),
	z.object({
		op: z.literal('add_sfx'),
		src: z.string().describe('project-relative file, e.g. media/sfx/x.wav'),
		at: z.number(),
		volume: z.number().default(0.5),
		role: z.string().optional(),
		why: z.string().optional(),
		group: z.string().optional().describe('link tag; items with the same tag move, copy, lock and delete together (e.g. a zoom and the spotlight on it)'),
	}),
	z.object({ op: z.literal('remove'), id: Id }),
	z.object({
		op: z.literal('set_time'),
		id: Id,
		start: z.number().optional().describe('new global start; the item keeps its length unless `end` is given'),
		end: z.number().optional().describe('new global end'),
	}),
	z.object({ op: z.literal('set_box'), id: Id, box: Box.partial() }),
	z.object({ op: z.literal('set_props'), id: Id, props: z.record(z.string(), z.unknown()) }),
	z.object({
		op: z.literal('set_style'),
		id: Id,
		enter: z.object({ preset: EnterPreset.optional(), direction: Direction.optional(), durationFrames: z.number().int().optional() }).optional(),
		exit: z.object({ preset: ExitPreset.optional(), durationFrames: z.number().int().optional() }).optional(),
		z: z.number().int().optional(),
		volume: z.number().optional(),
		in_frames: z.number().int().optional().describe('camera: zoom-in length'),
		out_frames: z.number().int().optional().describe('camera: zoom-out length'),
		to: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional().describe('camera: target region'),
		intensity: z.number().optional().describe('mood strength 0-1'),
		kind: MoodKind.optional(),
	}),
	z.object({ op: z.literal('duplicate'), id: Id, at: z.number().optional().describe('global start of the copy (default: right after the original)') }),
	z.object({ op: z.literal('split'), id: Id, at: z.number() }),
	z.object({ op: z.literal('lock'), id: Id, locked: z.boolean() }),
	z.object({ op: z.literal('add_marker'), at: z.number(), label: z.string().optional() }),
	z.object({ op: z.literal('remove_marker'), id: z.string().describe('marker id, e.g. mk1') }),
	z.object({ op: z.literal('set_enabled'), id: Id, enabled: z.boolean().describe('false keeps the item in the edit but stops it rendering / sounding; a grouped item switches its whole group') }),
	z.object({ op: z.literal('group'), ids: z.array(Id).min(2).describe('items to link (zoom, effects, sounds): afterwards they move, copy, lock and delete as one'), name: z.string().optional() }),
	z.object({ op: z.literal('ungroup'), id: Id.describe('any member: the whole group is released') }),
]);
export type Op = z.input<typeof Op>;

export interface ApplyNote {
	ok: boolean;
	op: Op;
	message: string;
	id?: string; // id of the item created or changed
}

// ------------------------------------------------------------------ helpers

const clone = <T,>(x: T): T => structuredClone(x);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const MIN_LEN = 0.15;

export interface Found {
	kind: 'layer' | 'camera' | 'mood' | 'sfx';
	beat?: Beat;
	index?: number;
	layer?: Layer;
	sfx?: SfxClip;
}

export const isContinuation = (l: Layer) => /^continues /.test(String(l.meta?.reason ?? ''));
const baseId = (id: string) => id.replace(/-b\d+$/, '');

/** Items have stable ids: layers keep theirs, camera moves are `<beat>cam<n>`, moods `mood-<beat>-<n>`, sound `sfxN`. */
export const camId = (b: Beat, i: number) => `${b.id}cam${i + 1}`;
export const moodId = (b: Beat, i: number) => `mood-${b.id}-${i}`;

export function find(edd: Edd, id: string): Found | null {
	for (const s of edd.audio.sfx) if (s.id === id) return { kind: 'sfx', sfx: s };
	for (const b of edd.beats) {
		for (const l of b.layers) if (l.id === id) return { kind: 'layer', beat: b, layer: l };
		b.camera.forEach((_, i) => {});
		const ci = b.camera.findIndex((_, i) => camId(b, i) === id);
		if (ci >= 0) return { kind: 'camera', beat: b, index: ci };
		const mi = b.moods.findIndex((_, i) => moodId(b, i) === id);
		if (mi >= 0) return { kind: 'mood', beat: b, index: mi };
	}
	return null;
}

const beatAt = (edd: Edd, t: number): Beat => edd.beats.find((b) => t >= b.start && t < b.end) ?? (t < edd.beats[0].start ? edd.beats[0] : edd.beats[edd.beats.length - 1]);

export const layerSpan = (b: Beat, l: Layer) => ({
	start: b.start + l.enter.at,
	end: l.exit ? b.start + l.exit.at + l.exit.durationFrames / 30 : b.end,
});

/** All segments of a layer (the original plus its `-bN` continuations), with global spans. */
export function segments(edd: Edd, id: string): { beat: Beat; layer: Layer; start: number; end: number }[] {
	const root = baseId(id);
	const out: { beat: Beat; layer: Layer; start: number; end: number }[] = [];
	for (const b of edd.beats) for (const l of b.layers) if (l.id === root || (l.id.startsWith(`${root}-`) && isContinuation(l))) out.push({ beat: b, layer: l, ...layerSpan(b, l) });
	return out.sort((a, z) => a.start - z.start);
}

function nextId(edd: Edd, prefix: string): string {
	const used = new Set(edd.beats.flatMap((b) => b.layers.map((l) => l.id)));
	let n = 1;
	while (used.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
}

const DEFAULTS: Record<string, { len: number; box: Layer['box']; space: Layer['space']; z: number; enter: Layer['enter']; props: Record<string, unknown>; exitPreset: Layer['exit'] extends infer E ? E extends { preset: infer P } ? P : never : never }> = {
	Title: { len: 1.8, box: { x: 8, y: 38, w: 84, h: 22, rotation: 0 }, space: 'screen', z: 20, enter: { at: 0, preset: 'slide-blur', direction: 'left', durationFrames: 9 }, props: { text: 'Title', uppercase: true }, exitPreset: 'slide' },
	KineticWord: { len: 1.2, box: { x: 12, y: 38, w: 76, h: 24, rotation: 0 }, space: 'screen', z: 15, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 7 }, props: { text: 'WORD', uppercase: true, variant: 'word' }, exitPreset: 'scale-out' },
	Header: { len: 4, box: { x: 5, y: 9.5, w: 40, h: 6, rotation: 0 }, space: 'screen', z: 25, enter: { at: 0, preset: 'slide', direction: 'left', durationFrames: 7 }, props: { text: 'Header', variant: 'header', align: 'left', color: 'accent' }, exitPreset: 'fade' },
	PopImage: { len: 2.2, box: { x: 42, y: 30, w: 16, h: 28.44, rotation: 0 }, space: 'screen', z: 10, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 8 }, props: {}, exitPreset: 'scale-out' },
	MemeSticker: { len: 2.2, box: { x: 39, y: 22, w: 21, h: 37, rotation: 0 }, space: 'screen', z: 30, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 8 }, props: {}, exitPreset: 'scale-out' },
	UILabel: { len: 2.6, box: { x: 40, y: 50, w: 20, h: 6, rotation: 0 }, space: 'stage', z: 18, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 7 }, props: { text: 'Label', target: { x: 38, y: 40, w: 24, h: 8 } }, exitPreset: 'fade' },
	ColorChip: { len: 1.8, box: { x: 85, y: 8, w: 9, h: 16, rotation: 0 }, space: 'screen', z: 20, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 7 }, props: { color: '#0A84FF', label: 'blue' }, exitPreset: 'fade' },
	CodeBlock: { len: 3.5, box: { x: 16, y: 20, w: 68, h: 60, rotation: 0 }, space: 'screen', z: 22, enter: { at: 0, preset: 'scale-in', direction: 'center', durationFrames: 10 }, props: { code: 'int main() {\n  return 0;\n}', reveal: 'lines', language: 'text' }, exitPreset: 'fade' },
	// Effects, transitions, captions and elements. They animate themselves ('cut' entrance) over their visible length.
	Highlight: { len: 3, box: { x: 30, y: 40, w: 24, h: 12, rotation: 0 }, space: 'stage', z: 17, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { shape: 'box', color: 'accent', thickness: 6, fill: 0, pulse: false }, exitPreset: 'fade' },
	Spotlight: { len: 3, box: { x: 30, y: 38, w: 30, h: 18, rotation: 0 }, space: 'stage', z: 12, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { dim: 0.65, shape: 'box', ring: true }, exitPreset: 'fade' },
	BlurRegion: { len: 3, box: { x: 35, y: 40, w: 24, h: 12, rotation: 0 }, space: 'stage', z: 16, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { mode: 'blur', amount: 22, shape: 'box' }, exitPreset: 'fade' },
	Arrow: { len: 2.5, box: { x: 40, y: 44, w: 14, h: 9, rotation: 0 }, space: 'stage', z: 19, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { color: 'accent', thickness: 12, bob: true }, exitPreset: 'fade' },
	ClickRipple: { len: 1.6, box: { x: 46, y: 42, w: 8, h: 14.2, rotation: 0 }, space: 'stage', z: 19, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { color: 'accent', rings: 2, cursor: true }, exitPreset: 'fade' },
	StepBadge: { len: 3, box: { x: 6, y: 12, w: 7, h: 12.4, rotation: 0 }, space: 'screen', z: 24, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 8 }, props: { n: 1, color: 'accent' }, exitPreset: 'scale-out' },
	LowerThird: { len: 4, box: { x: 5, y: 74, w: 42, h: 14, rotation: 0 }, space: 'screen', z: 24, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { title: 'Name', subtitle: 'Role', color: 'accent' }, exitPreset: 'fade' },
	Flash: { len: 0.25, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 60, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { color: 'white', intensity: 0.9 }, exitPreset: 'cut' },
	FadeBlack: { len: 0.8, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 61, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { mode: 'dip', color: 'black' }, exitPreset: 'cut' },
	Reveal: { len: 0.8, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 62, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { style: 'iris', color: 'black' }, exitPreset: 'cut' },
	Wipe: { len: 0.7, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 62, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { direction: 'right', color: 'accent' }, exitPreset: 'cut' },
	Glitch: { len: 0.45, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 63, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { intensity: 0.7 }, exitPreset: 'cut' },
	Vignette: { len: 3, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 5, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { strength: 0.55 }, exitPreset: 'fade' },
	Letterbox: { len: 4, box: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }, space: 'screen', z: 64, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { size: 11 }, exitPreset: 'fade' },
	Captions: { len: 5, box: { x: 5, y: 66, w: 90, h: 26, rotation: 0 }, space: 'screen', z: 40, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, props: { words: [], style: 'pop', position: 'bottom', color: 'accent', size: 0.07, uppercase: true, maxWords: 4 }, exitPreset: 'cut' },
	Generated: { len: 3, box: { x: 38, y: 28, w: 24, h: 42.7, rotation: 0 }, space: 'stage', z: 22, enter: { at: 0, preset: 'pop', direction: 'center', durationFrames: 8 }, props: {}, exitPreset: 'scale-out' },
	Terminal: { len: 3, box: { x: 14, y: 62, w: 72, h: 24, rotation: 0 }, space: 'screen', z: 22, enter: { at: 0, preset: 'slide', direction: 'up', durationFrames: 8 }, props: { prompt: '$', command: 'echo hello', output: [], title: 'Terminal' }, exitPreset: 'fade' },
};
const FALLBACK = DEFAULTS.Title;

// ------------------------------------------------------------------ layer placement across beats

/** Remove every segment of a layer from the document. */
function dropLayer(edd: Edd, id: string) {
	const root = baseId(id);
	for (const b of edd.beats) b.layers = b.layers.filter((l) => !(l.id === root || (l.id.startsWith(`${root}-`) && isContinuation(l))));
}

/** Put a layer on the global timeline: start in its beat, continue into later beats if it runs past the end. */
function placeLayer(edd: Edd, layer: Layer, start: number, end: number) {
	const total = edd.beats[edd.beats.length - 1].end;
	start = Math.max(0, Math.min(start, total - MIN_LEN));
	end = Math.max(start + MIN_LEN, Math.min(end, total));
	const root = baseId(layer.id);
	let first = true;
	for (const b of edd.beats) {
		if (end <= b.start + 1e-6 || start >= b.end - 1e-6) continue;
		const s = Math.max(start, b.start);
		const e = Math.min(end, b.end);
		const seg = clone(layer);
		seg.id = first ? root : `${root}-${b.id}`;
		seg.enter.at = r3(s - b.start);
		if (!first) {
			seg.enter = { ...seg.enter, at: 0, preset: 'cut', durationFrames: 0 };
			seg.meta = { ...seg.meta, reason: `continues ${root}` };
		}
		const exitFrames = layer.exit?.durationFrames ?? 5;
		if (e < b.end - 0.02 && (e >= end - 1e-6)) {
			// This is the last segment and it ends inside the beat: give it an exit that finishes at `e`.
			seg.exit = { preset: layer.exit?.preset ?? 'fade', durationFrames: exitFrames, at: r3(Math.max(seg.enter.at + 0.05, e - b.start - exitFrames / 30)) };
		} else delete seg.exit;
		b.layers.push(seg);
		first = false;
	}
}

// ------------------------------------------------------------------ apply

export interface ApplyContext {
	/** Optional: resolve OCR/words/motion for intent ops. Not needed for raw ops. */
	fps?: number;
}

export function applyOps(edd: Edd, ops: Op[], author: 'user' | 'ai' = 'user'): { edd: Edd; notes: ApplyNote[] } {
	let cur = clone(edd);
	const notes: ApplyNote[] = [];
	for (const op of ops) {
		const draft = clone(cur);
		try {
			const note = applyOne(draft, op, author);
			const check = Edd.safeParse(draft);
			if (!check.success) {
				notes.push({ ok: false, op, message: `not valid: ${check.error.issues[0]?.message ?? 'schema error'}` });
				continue;
			}
			cur = check.data;
			notes.push(note);
		} catch (e) {
			notes.push({ ok: false, op, message: e instanceof Error ? e.message : String(e) });
		}
	}
	return { edd: cur, notes };
}

function meta(author: 'user' | 'ai', why?: string, group?: string) {
	return { origin: author === 'user' ? ('user' as const) : ('ai' as const), locked: false, reason: why ?? (author === 'user' ? 'added by you' : undefined), ...(group ? { group } : {}) };
}

// ------------------------------------------------------------------ groups
// A group is a shared `meta.group` tag. The commands that move, copy, lock or remove things look at it, so a zoom and the spotlight on it
// behave as one object while each stays an ordinary item (still resizable, restylable, or ungroupable on its own).

type Mood = Beat['moods'][number];
type Cam = Beat['camera'][number];

export function metaOfItem(edd: Edd, id: string): { locked: boolean; group?: string; disabled?: boolean } | null {
	const f = find(edd, id);
	if (!f) return null;
	if (f.kind === 'layer') return f.layer!.meta;
	if (f.kind === 'camera') return f.beat!.camera[f.index!].meta;
	if (f.kind === 'mood') return f.beat!.moods[f.index!].meta;
	return f.sfx!.meta;
}

/** Ids of every item carrying this tag (layers once, without their continuation segments). */
export function groupMembers(edd: Edd, name: string): string[] {
	const ids: string[] = [];
	for (const s of edd.audio.sfx) if (s.meta.group === name) ids.push(s.id);
	for (const b of edd.beats) {
		for (const l of b.layers) if (!isContinuation(l) && l.meta.group === name) ids.push(l.id);
		b.camera.forEach((c, i) => { if (c.meta.group === name) ids.push(camId(b, i)); });
		b.moods.forEach((m, i) => { if (m.meta.group === name) ids.push(moodId(b, i)); });
	}
	return ids;
}

/** The members of the group an item belongs to (itself included), or just [id] when it is ungrouped. */
export function withGroup(edd: Edd, id: string): string[] {
	const g = metaOfItem(edd, id)?.group;
	return g ? groupMembers(edd, g) : [id];
}

/** Selecting one member selects its whole group. */
export function expandGroups(edd: Edd, ids: string[]): string[] {
	return Array.from(new Set(ids.flatMap((id) => (find(edd, id) ? withGroup(edd, id) : [id]))));
}

/** One id per group: the group commands already act on every member, so a multi-selection must not repeat them. */
export function oneOfEach(edd: Edd, ids: string[]): string[] {
	const seen = new Set<string>();
	return ids.filter((id) => {
		const g = metaOfItem(edd, id)?.group;
		if (!g) return true;
		if (seen.has(g)) return false;
		seen.add(g);
		return true;
	});
}

export interface Held { kind: Found['kind']; obj: Layer | Cam | Mood | SfxClip; start: number; end: number; exit?: Layer['exit'] }

/** A copy of an item with its global span; the document is left alone. */
export function peek(edd: Edd, id: string): Held {
	const f = find(edd, id);
	if (!f) throw new Error(`no item ${id}`);
	if (f.kind === 'layer') {
		const segs = segments(edd, id);
		return { kind: 'layer', obj: clone(segs[0].layer), start: segs[0].start, end: segs[segs.length - 1].end, exit: clone(segs[0].layer.exit ?? segs[segs.length - 1].layer.exit) };
	}
	if (f.kind === 'camera') {
		const c = f.beat!.camera[f.index!];
		const start = f.beat!.start + c.at;
		return { kind: 'camera', obj: clone(c), start, end: start + c.inFrames / 30 + c.hold + c.outFrames / 30 };
	}
	if (f.kind === 'mood') {
		const m = f.beat!.moods[f.index!];
		return { kind: 'mood', obj: clone(m), start: f.beat!.start + m.at, end: f.beat!.start + m.at + m.duration };
	}
	return { kind: 'sfx', obj: clone(f.sfx!), start: f.sfx!.at, end: f.sfx!.at + 0.4 };
}

export function dropItem(edd: Edd, id: string) {
	const f = find(edd, id);
	if (!f) return;
	if (f.kind === 'layer') dropLayer(edd, id);
	else if (f.kind === 'camera') f.beat!.camera.splice(f.index!, 1);
	else if (f.kind === 'mood') f.beat!.moods.splice(f.index!, 1);
	else edd.audio.sfx = edd.audio.sfx.filter((s) => s.id !== id);
}

/** Put a held item back at a new global start (keeping its length). Returns its (possibly new) id. */
export function insertItem(edd: Edd, h: Held, ns: number, patch?: { group?: string; fresh?: boolean }): string {
	const meta = h.obj.meta;
	meta.origin = 'user';
	if (patch && 'group' in patch) { if (patch.group) meta.group = patch.group; else delete meta.group; }
	if (patch?.fresh) { meta.locked = false; meta.reason = 'duplicated by you'; }
	if (h.kind === 'layer') {
		const l = h.obj as Layer;
		if (patch?.fresh) l.id = nextId(edd, 'u');
		if (h.exit) l.exit = h.exit;
		placeLayer(edd, l, ns, ns + (h.end - h.start));
		return baseId(l.id);
	}
	if (h.kind === 'camera') {
		const c = h.obj as Cam;
		const nb = beatAt(edd, ns);
		c.at = r3(Math.max(0, ns - nb.start));
		nb.camera.push(c);
		nb.camera.sort((a, z) => a.at - z.at);
		return camId(nb, nb.camera.indexOf(c));
	}
	if (h.kind === 'mood') {
		const m = h.obj as Mood;
		const nb = beatAt(edd, ns);
		m.at = r3(Math.max(0, ns - nb.start));
		m.duration = r3(Math.min(m.duration, Math.max(0.2, nb.end - ns)));
		nb.moods.push(m);
		return moodId(nb, nb.moods.indexOf(m));
	}
	const s = h.obj as SfxClip;
	const used = new Set(edd.audio.sfx.map((x) => x.id));
	if (patch?.fresh || used.has(s.id)) { let n = edd.audio.sfx.length + 1; while (used.has(`sfx${n}`)) n++; s.id = `sfx${n}`; }
	s.at = r3(Math.max(0, ns));
	edd.audio.sfx.push(s);
	edd.audio.sfx.sort((a, z) => a.at - z.at);
	return s.id;
}

export function newGroupName(edd: Edd): string {
	const used = new Set<string>();
	for (const s of edd.audio.sfx) if (s.meta.group) used.add(s.meta.group);
	for (const b of edd.beats) {
		for (const l of b.layers) if (l.meta.group) used.add(l.meta.group);
		for (const c of b.camera) if (c.meta.group) used.add(c.meta.group);
		for (const m of b.moods) if (m.meta.group) used.add(m.meta.group);
	}
	let n = 1;
	while (used.has(`g${n}`)) n++;
	return `g${n}`;
}

function setGroup(edd: Edd, id: string, group?: string) {
	const f = find(edd, id);
	if (!f) throw new Error(`no item ${id}`);
	const apply = (m: { group?: string }) => { if (group) m.group = group; else delete m.group; };
	if (f.kind === 'layer') segments(edd, id).forEach((s) => apply(s.layer.meta));
	else if (f.kind === 'camera') apply(f.beat!.camera[f.index!].meta);
	else if (f.kind === 'mood') apply(f.beat!.moods[f.index!].meta);
	else apply(f.sfx!.meta);
}

function assertUnlocked(edd: Edd, ids: string[]) {
	for (const id of ids) if (metaOfItem(edd, id)?.locked) throw new Error(`${id} is locked`);
}

function applyOne(edd: Edd, op: Op, author: 'user' | 'ai'): ApplyNote {
	switch (op.op) {
		case 'add_layer': {
			const d = DEFAULTS[op.component] ?? FALLBACK;
			const start = op.at;
			const end = op.until ?? start + d.len;
			const id = nextId(edd, 'u');
			const layer: Layer = {
				id,
				component: op.component,
				props: { ...d.props, ...(op.props ?? {}) },
				box: { ...d.box, ...(op.box ?? {}), rotation: op.box?.rotation ?? 0 },
				space: op.space ?? d.space,
				z: d.z,
				enter: { ...d.enter, ...(op.enter ?? {}), direction: op.enter?.direction ?? d.enter.direction, durationFrames: op.enter?.durationFrames ?? d.enter.durationFrames, at: 0 },
				exit: { at: 0, preset: d.exitPreset, durationFrames: 5 },
				meta: meta(author, op.why, op.group),
			};
			placeLayer(edd, layer, start, end);
			return { ok: true, op, id, message: `added ${op.component} ${id} at ${r3(start)} s` };
		}
		case 'add_zoom': {
			const b = beatAt(edd, op.at);
			const at = Math.max(op.at, b.start);
			const hold = Math.max(0.3, Math.min(op.until, b.end - 0.4) - at - 0.2);
			b.camera.push({ at: r3(at - b.start), to: op.to, inFrames: 6, hold: r3(hold), outFrames: 10, tiltDeg: 0, meta: meta(author, op.why, op.group) });
			b.camera.sort((a, z) => a.at - z.at);
			const idx = b.camera.findIndex((c) => c.at === r3(at - b.start) && c.to === op.to);
			return { ok: true, op, id: camId(b, Math.max(0, idx)), message: `added zoom at ${r3(at)} s` };
		}
		case 'add_mood': {
			const b = beatAt(edd, op.at);
			b.moods.push({ kind: op.kind, at: r3(Math.max(0, op.at - b.start)), duration: Math.min(op.duration ?? 1.2, b.end - op.at), intensity: 0.6, meta: meta(author, op.why, op.group) });
			return { ok: true, op, id: moodId(b, b.moods.length - 1), message: `added ${op.kind} mood at ${r3(op.at)} s` };
		}
		case 'add_sfx': {
			const used = new Set(edd.audio.sfx.map((s) => s.id));
			let n = edd.audio.sfx.length + 1;
			while (used.has(`sfx${n}`)) n++;
			edd.audio.sfx.push({ id: `sfx${n}`, src: op.src, at: r3(Math.max(0, op.at)), volume: op.volume ?? 0.5, role: op.role, meta: meta(author, op.why, op.group) });
			edd.audio.sfx.sort((a, z) => a.at - z.at);
			return { ok: true, op, id: `sfx${n}`, message: `added sound at ${r3(op.at)} s` };
		}
		case 'remove': {
			const f = find(edd, op.id);
			if (!f) throw new Error(`no item ${op.id}`);
			const crew = withGroup(edd, op.id);
			if (crew.length > 1) {
				assertUnlocked(edd, crew);
				for (const id of crew) dropItem(edd, id);
				return { ok: true, op, message: `removed ${op.id} and the ${crew.length - 1} item(s) grouped with it` };
			}
			if (f.kind === 'layer') {
				if (f.layer!.meta.locked) throw new Error(`${op.id} is locked`);
				dropLayer(edd, op.id);
			} else if (f.kind === 'camera') {
				if (f.beat!.camera[f.index!].meta.locked) throw new Error(`${op.id} is locked`);
				f.beat!.camera.splice(f.index!, 1);
			} else if (f.kind === 'mood') {
				if (f.beat!.moods[f.index!].meta.locked) throw new Error(`${op.id} is locked`);
				f.beat!.moods.splice(f.index!, 1);
			} else edd.audio.sfx = edd.audio.sfx.filter((s) => s.id !== op.id);
			return { ok: true, op, message: `removed ${op.id}` };
		}
		case 'set_time': {
			const f = find(edd, op.id);
			if (!f) throw new Error(`no item ${op.id}`);
			// Moving one member (a new start, no new end) moves the whole group by the same amount. Resizing an edge only touches that item.
			const crew = withGroup(edd, op.id);
			if (crew.length > 1 && op.start !== undefined && op.end === undefined) {
				assertUnlocked(edd, crew);
				const held = crew.map((id) => ({ id, h: peek(edd, id) }));
				const lead = held.find((x) => x.id === op.id)!;
				const total = edd.beats[edd.beats.length - 1].end;
				let delta = op.start - lead.h.start;
				delta = Math.max(delta, -Math.min(...held.map((x) => x.h.start)));
				delta = Math.min(delta, total - MIN_LEN - Math.max(...held.map((x) => x.h.start)));
				for (const x of held) dropItem(edd, x.id);
				let leadId = op.id;
				for (const x of held) { const nid = insertItem(edd, x.h, x.h.start + delta); if (x.id === op.id) leadId = nid; }
				return { ok: true, op, id: leadId, message: `moved ${op.id} and ${crew.length - 1} grouped item(s) by ${r3(delta)} s` };
			}
			if (f.kind === 'sfx') {
				if (f.sfx!.meta.locked) throw new Error(`${op.id} is locked`);
				f.sfx!.at = r3(Math.max(0, op.start ?? f.sfx!.at));
				f.sfx!.meta.origin = 'user';
				edd.audio.sfx.sort((a, z) => a.at - z.at);
				return { ok: true, op, id: op.id, message: `moved ${op.id}` };
			}
			if (f.kind === 'layer') {
				const segs = segments(edd, op.id);
				const s0 = segs[0].start;
				const e0 = segs[segs.length - 1].end;
				const root = segs[0].layer;
				if (root.meta.locked) throw new Error(`${op.id} is locked`);
				const ns = op.start ?? s0;
				const ne = op.end ?? (op.start !== undefined ? ns + (e0 - s0) : e0);
				const keep = clone(root);
				keep.meta.origin = 'user';
				const exitProto = keep.exit ?? segs[segs.length - 1].layer.exit;
				if (exitProto) keep.exit = exitProto;
				dropLayer(edd, op.id);
				placeLayer(edd, keep, ns, ne);
				return { ok: true, op, id: baseId(op.id), message: `retimed ${op.id} to ${r3(ns)}–${r3(ne)} s` };
			}
			if (f.kind === 'camera') {
				const b = f.beat!;
				const c = b.camera[f.index!];
				if (c.meta.locked) throw new Error(`${op.id} is locked`);
				const s0 = b.start + c.at;
				const dur = c.inFrames / 30 + c.hold + c.outFrames / 30; // the span the UI shows: in + hold + out
				const ns = op.start ?? s0;
				const ne = op.end ?? (op.start !== undefined ? ns + dur : s0 + dur);
				b.camera.splice(f.index!, 1);
				const nb = beatAt(edd, ns);
				c.at = r3(Math.max(0, ns - nb.start));
				c.hold = r3(Math.max(0.3, Math.min(ne, nb.end - 0.2) - ns - c.inFrames / 30 - c.outFrames / 30));
				c.meta.origin = 'user';
				nb.camera.push(c);
				nb.camera.sort((a, z) => a.at - z.at);
				return { ok: true, op, id: camId(nb, nb.camera.indexOf(c)), message: `retimed ${op.id}` };
			}
			const b = f.beat!;
			const m = b.moods[f.index!];
			if (m.meta.locked) throw new Error(`${op.id} is locked`);
			const ns = op.start ?? b.start + m.at;
			const ne = op.end ?? (op.start !== undefined ? ns + m.duration : b.start + m.at + m.duration);
			b.moods.splice(f.index!, 1);
			const nb = beatAt(edd, ns);
			m.at = r3(Math.max(0, ns - nb.start));
			m.duration = r3(Math.max(0.2, Math.min(ne, nb.end) - ns));
			m.meta.origin = 'user';
			nb.moods.push(m);
			return { ok: true, op, id: moodId(nb, nb.moods.indexOf(m)), message: `retimed ${op.id}` };
		}
		case 'set_box': {
			const f = find(edd, op.id);
			if (!f || f.kind !== 'layer') throw new Error(`${op.id} is not a layer`);
			for (const s of segments(edd, op.id)) {
				if (s.layer.meta.locked) throw new Error(`${op.id} is locked`);
				s.layer.box = { ...s.layer.box, ...op.box } as Layer['box'];
				s.layer.meta.origin = 'user';
			}
			return { ok: true, op, id: op.id, message: `moved/resized ${op.id}` };
		}
		case 'set_props': {
			const f = find(edd, op.id);
			if (!f || f.kind !== 'layer') throw new Error(`${op.id} is not a layer`);
			for (const s of segments(edd, op.id)) {
				if (s.layer.meta.locked) throw new Error(`${op.id} is locked`);
				s.layer.props = { ...s.layer.props, ...op.props };
				s.layer.meta.origin = 'user';
			}
			return { ok: true, op, id: op.id, message: `updated ${op.id}` };
		}
		case 'set_style': {
			const f = find(edd, op.id);
			if (!f) throw new Error(`no item ${op.id}`);
			if (f.kind === 'layer') {
				const segs = segments(edd, op.id);
				segs.forEach((s, i) => {
					const l = s.layer;
					if (l.meta.locked) throw new Error(`${op.id} is locked`);
					if (op.enter && i === 0) l.enter = { ...l.enter, ...op.enter, direction: op.enter.direction ?? l.enter.direction } as Layer['enter'];
					if (op.exit && i === segs.length - 1 && l.exit) l.exit = { ...l.exit, ...op.exit } as NonNullable<Layer['exit']>;
					if (op.z !== undefined) l.z = op.z;
					l.meta.origin = 'user';
				});
			} else if (f.kind === 'camera') {
				const c = f.beat!.camera[f.index!];
				if (c.meta.locked) throw new Error(`${op.id} is locked`);
				if (op.in_frames) c.inFrames = op.in_frames;
				if (op.out_frames !== undefined) c.outFrames = op.out_frames;
				if (op.to) c.to = op.to;
				c.meta.origin = 'user';
			} else if (f.kind === 'mood') {
				const m = f.beat!.moods[f.index!];
				if (m.meta.locked) throw new Error(`${op.id} is locked`);
				if (op.intensity !== undefined) m.intensity = op.intensity;
				if (op.kind) m.kind = op.kind;
				m.meta.origin = 'user';
			} else {
				if (op.volume !== undefined) f.sfx!.volume = op.volume;
				f.sfx!.meta.origin = 'user';
			}
			return { ok: true, op, id: op.id, message: `restyled ${op.id}` };
		}
		case 'duplicate': {
			const f = find(edd, op.id);
			if (!f) throw new Error(`no item ${op.id}`);
			const crew = withGroup(edd, op.id);
			if (crew.length > 1) {
				const held = crew.map((id) => ({ id, h: peek(edd, id) }));
				const lead = held.find((x) => x.id === op.id)!;
				const first = Math.min(...held.map((x) => x.h.start));
				const last = Math.max(...held.map((x) => x.h.end));
				const delta = (op.at ?? last + 0.2 + (lead.h.start - first)) - lead.h.start;
				const name = newGroupName(edd);
				let leadId = op.id;
				for (const x of held) { const nid = insertItem(edd, x.h, x.h.start + delta, { group: name, fresh: true }); if (x.id === op.id) leadId = nid; }
				return { ok: true, op, id: leadId, message: `duplicated ${crew.length} grouped items` };
			}
			if (f.kind === 'sfx') {
				const used = new Set(edd.audio.sfx.map((s) => s.id));
				let n = edd.audio.sfx.length + 1;
				while (used.has(`sfx${n}`)) n++;
				edd.audio.sfx.push({ ...clone(f.sfx!), id: `sfx${n}`, at: r3(op.at ?? f.sfx!.at + 0.5), meta: { ...f.sfx!.meta, origin: 'user', locked: false } });
				edd.audio.sfx.sort((a, z) => a.at - z.at);
				return { ok: true, op, id: `sfx${n}`, message: 'duplicated sound' };
			}
			if (f.kind === 'layer') {
				const segs = segments(edd, op.id);
				const s0 = segs[0].start;
				const e0 = segs[segs.length - 1].end;
				const copy = clone(segs[0].layer);
				copy.id = nextId(edd, 'u');
				copy.meta = { origin: 'user', locked: false, reason: 'duplicated by you' };
				const ns = op.at ?? e0 + 0.2;
				placeLayer(edd, copy, ns, ns + (e0 - s0));
				return { ok: true, op, id: copy.id, message: `duplicated ${op.id}` };
			}
			if (f.kind === 'camera') {
				const b = f.beat!;
				const c = clone(b.camera[f.index!]);
				const ns = op.at ?? b.start + c.at + c.inFrames / 30 + c.hold + 1;
				const nb = beatAt(edd, ns);
				c.at = r3(ns - nb.start);
				c.meta = { origin: 'user', locked: false, reason: 'duplicated by you' };
				nb.camera.push(c);
				nb.camera.sort((a, z) => a.at - z.at);
				return { ok: true, op, id: camId(nb, nb.camera.indexOf(c)), message: 'duplicated zoom' };
			}
			throw new Error('cannot duplicate this item');
		}
		case 'split': {
			const f = find(edd, op.id);
			if (!f || f.kind !== 'layer') throw new Error('only layers can be split');
			const segs = segments(edd, op.id);
			const s0 = segs[0].start;
			const e0 = segs[segs.length - 1].end;
			if (op.at <= s0 + MIN_LEN || op.at >= e0 - MIN_LEN) throw new Error('split point must be inside the item');
			const proto = clone(segs[0].layer);
			if (proto.meta.locked) throw new Error(`${op.id} is locked`);
			const exit = segs[segs.length - 1].layer.exit;
			dropLayer(edd, op.id);
			const a = clone(proto);
			a.meta.origin = 'user';
			if (exit) a.exit = exit;
			placeLayer(edd, a, s0, op.at);
			const b2 = clone(proto);
			b2.id = nextId(edd, 'u');
			b2.meta = { origin: 'user', locked: false, reason: `split from ${baseId(op.id)}` };
			if (exit) b2.exit = exit;
			placeLayer(edd, b2, op.at, e0);
			return { ok: true, op, id: b2.id, message: `split ${op.id} at ${r3(op.at)} s` };
		}
		case 'lock': {
			const f = find(edd, op.id);
			if (!f) throw new Error(`no item ${op.id}`);
			const crew = withGroup(edd, op.id);
			if (crew.length > 1) {
				for (const id of crew) { const g = find(edd, id)!; if (g.kind === 'layer') segments(edd, id).forEach((x) => (x.layer.meta.locked = op.locked)); else metaOfItem(edd, id)!.locked = op.locked; }
				return { ok: true, op, id: op.id, message: `${op.locked ? 'locked' : 'unlocked'} ${crew.length} grouped items` };
			}
			if (f.kind === 'layer') segments(edd, op.id).forEach((s) => (s.layer.meta.locked = op.locked));
			else if (f.kind === 'camera') f.beat!.camera[f.index!].meta.locked = op.locked;
			else if (f.kind === 'mood') f.beat!.moods[f.index!].meta.locked = op.locked;
			else f.sfx!.meta.locked = op.locked;
			return { ok: true, op, id: op.id, message: `${op.locked ? 'locked' : 'unlocked'} ${op.id}` };
		}
		case 'add_marker': {
			const used = new Set(edd.markers.map((m) => m.id));
			let n = edd.markers.length + 1;
			while (used.has(`mk${n}`)) n++;
			edd.markers.push({ id: `mk${n}`, at: r3(Math.max(0, op.at)), label: op.label ?? `Marker ${n}` });
			edd.markers.sort((a, z) => a.at - z.at);
			return { ok: true, op, id: `mk${n}`, message: `marked ${r3(op.at)} s` };
		}
		case 'remove_marker': {
			if (!edd.markers.some((m) => m.id === op.id)) throw new Error(`no marker ${op.id}`);
			edd.markers = edd.markers.filter((m) => m.id !== op.id);
			return { ok: true, op, message: `removed marker ${op.id}` };
		}
		case 'set_enabled': {
			const crew = withGroup(edd, op.id);
			if (!crew.length || !find(edd, op.id)) throw new Error(`no item ${op.id}`);
			assertUnlocked(edd, crew);
			for (const id of crew) {
				const f = find(edd, id)!;
				const apply = (m: { disabled?: boolean }) => { if (op.enabled) delete m.disabled; else m.disabled = true; };
				if (f.kind === 'layer') segments(edd, id).forEach((x) => apply(x.layer.meta));
				else apply(metaOfItem(edd, id) as { disabled?: boolean });
			}
			return { ok: true, op, id: op.id, message: `${op.enabled ? 'enabled' : 'disabled'} ${crew.length} item(s)` };
		}
		case 'group': {
			const ids = Array.from(new Set(op.ids));
			for (const id of ids) if (!find(edd, id)) throw new Error(`no item ${id}`);
			// Joining an existing group pulls its other members in too, so groups never half-merge.
			const all = Array.from(new Set(ids.flatMap((id) => withGroup(edd, id))));
			const name = op.name ?? newGroupName(edd);
			for (const id of all) setGroup(edd, id, name);
			return { ok: true, op, id: name, message: `grouped ${all.length} items as ${name}` };
		}
		case 'ungroup': {
			const crew = withGroup(edd, op.id);
			if (crew.length < 2 && !metaOfItem(edd, op.id)?.group) throw new Error(`${op.id} is not in a group`);
			for (const id of crew) setGroup(edd, id, undefined);
			return { ok: true, op, id: op.id, message: `ungrouped ${crew.length} items` };
		}
	}
}

/**
 * Ripple delete: remove `ids` (and whatever is grouped with them), then slide every later, unlocked item left by the
 * width of the hole so the gap closes. Returns plain ops, so the UI, scripts and the AI all share one implementation.
 */
export function rippleOps(edd: Edd, ids: string[]): Op[] {
	const doomed = new Set(ids.flatMap((id) => (find(edd, id) ? withGroup(edd, id) : [])));
	const spans = [...doomed].map((id) => spanOf(edd, id)).filter((x): x is { start: number; end: number } => !!x);
	if (!spans.length) return [];
	const from = Math.min(...spans.map((x) => x.start));
	const to = Math.max(...spans.map((x) => x.end));
	const gap = to - from;
	const later: { id: string; start: number }[] = [];
	const seen = new Set<string>();
	const all: string[] = [];
	for (const s of edd.audio.sfx) all.push(s.id);
	for (const b of edd.beats) {
		for (const l of b.layers) if (!isContinuation(l)) all.push(l.id);
		b.camera.forEach((_, i) => all.push(camId(b, i)));
		b.moods.forEach((_, i) => all.push(moodId(b, i)));
	}
	for (const id of all) {
		if (doomed.has(id)) continue;
		const sp = spanOf(edd, id);
		const m = metaOfItem(edd, id);
		if (!sp || !m || m.locked || sp.start < to - 1e-6) continue;
		// A group moves as one: only its first member (in time) issues the move.
		if (m.group) { if (seen.has(m.group)) continue; seen.add(m.group); }
		later.push({ id, start: sp.start });
	}
	later.sort((a, z) => a.start - z.start);
	return [
		...oneOfEach(edd, [...doomed]).map((id) => ({ op: 'remove' as const, id })),
		...later.map((x) => ({ op: 'set_time' as const, id: x.id, start: Math.max(0, x.start - gap) })),
	];
}

/** Every item id in the edit (layers once each, cameras, moods, sounds). */
export function allItemIds(edd: Edd): string[] {
	const ids: string[] = [];
	for (const s of edd.audio.sfx) ids.push(s.id);
	for (const b of edd.beats) {
		for (const l of b.layers) if (!isContinuation(l)) ids.push(l.id);
		b.camera.forEach((_, i) => ids.push(camId(b, i)));
		b.moods.forEach((_, i) => ids.push(moodId(b, i)));
	}
	return ids;
}

/**
 * Premiere's Lift and Extract between In and Out. Items lying wholly inside the range (and unlocked, and whose whole group is
 * inside too) are removed; Extract also slides every later, unlocked item left by the width of the range so no gap remains.
 */
export function rangeOps(edd: Edd, from: number, to: number, closeGap: boolean): Op[] {
	if (!(to > from)) return [];
	const eps = 0.02;
	const inside = (id: string) => { const sp = spanOf(edd, id); return !!sp && sp.start >= from - eps && sp.end <= to + eps; };
	const doomed = allItemIds(edd).filter((id) => {
		const m = metaOfItem(edd, id);
		if (!m || m.locked || !inside(id)) return false;
		return withGroup(edd, id).every((g) => inside(g) && !metaOfItem(edd, g)?.locked);
	});
	const gone = new Set(doomed.flatMap((id) => withGroup(edd, id)));
	const ops: Op[] = oneOfEach(edd, doomed).map((id) => ({ op: 'remove' as const, id }));
	if (closeGap) {
		const gap = to - from;
		const seen = new Set<string>();
		const later: { id: string; start: number }[] = [];
		for (const id of allItemIds(edd)) {
			if (gone.has(id)) continue;
			const sp = spanOf(edd, id);
			const m = metaOfItem(edd, id);
			if (!sp || !m || m.locked || sp.start < to - eps) continue;
			if (m.group) { if (seen.has(m.group)) continue; seen.add(m.group); }
			later.push({ id, start: sp.start });
		}
		later.sort((a, z) => a.start - z.start);
		for (const x of later) ops.push({ op: 'set_time', id: x.id, start: Math.max(0, x.start - gap) });
	}
	return ops;
}

/** Global [start, end] of an item, for the UI. */
export function spanOf(edd: Edd, id: string): { start: number; end: number } | null {
	const f = find(edd, id);
	if (!f) return null;
	if (f.kind === 'sfx') return { start: f.sfx!.at, end: f.sfx!.at + 0.4 };
	if (f.kind === 'layer') {
		const segs = segments(edd, id);
		return { start: segs[0].start, end: segs[segs.length - 1].end };
	}
	if (f.kind === 'camera') {
		const c = f.beat!.camera[f.index!];
		const s = f.beat!.start + c.at;
		return { start: s, end: s + c.inFrames / 30 + c.hold + c.outFrames / 30 };
	}
	const m = f.beat!.moods[f.index!];
	return { start: f.beat!.start + m.at, end: f.beat!.start + m.at + m.duration };
}
