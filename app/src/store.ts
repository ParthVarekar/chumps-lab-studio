import { create } from 'zustand';
import type { Edd } from '@cls/engine/src/edd/schema';
import { expandGroups, find, spanOf, type ApplyNote, type Op } from '../shared/ops';
import { api, subscribe, type MediaItem, type NewProjectArgs, type AssistantReply, type ComponentSchemas, type ElementEntry, type Opened, type ProjectInfo, type Word } from './api';
import { placeOp, type Geometry, type Tile } from './ui/tiles';

export type Tab = 'media' | 'add' | 'effects' | 'transitions' | 'captions' | 'elements' | 'logos' | 'stickers' | 'sounds' | 'transcript';
export type RightTab = 'inspector' | 'assistant' | 'review';
export type Pick = null | { kind: 'zoom' | 'label' | 'region' } | { kind: 'focus'; effect: 'spotlight' | 'hl-box' | 'hl-ellipse' } | { kind: 'retarget'; id: string } | { kind: 'place'; tile: Tile };
export type Region = { x: number; y: number; w: number; h: number };

export interface Draft {
	edd: Edd;
	notes: ApplyNote[];
	ops: Op[];
	label: string;
}
export interface Msg {
	id: number;
	who: 'you' | 'ai';
	text: string;
	ops?: Op[];
	notes?: ApplyNote[];
	options?: string[];
	state?: 'pending' | 'applied' | 'discarded';
	source?: string;
}

interface State {
	projects: ProjectInfo[];
	dir: string | null;
	assetBase: string;
	edd: Edd | null;
	rev: number;
	words: Word[];
	report: any | null;
	canUndo: boolean;
	canRedo: boolean;
	selection: string[];
	time: number;
	playing: boolean;
	zoom: number; // timeline px per second
	status: string;
	log: string;
	busy: string | null; // 'render' | 'replan' | null
	renderOutput: string | null;
	draft: Draft | null;
	pick: Pick;
	region: Region | null;
	leftTab: Tab;
	rightTab: RightTab;
	msgs: Msg[];
	guides: boolean;
	schemas: ComponentSchemas;
	elements: ElementEntry[];
	designing: string | null;
	seekTo: (t: number) => void; // installed by the preview
	playPause: (want?: boolean) => void; // installed by the preview: toggle, or force play / pause
	/** Active tool: V selects and moves, C is the razor (a click on a clip cuts it there). */
	tool: 'select' | 'razor';
	/** Premiere-style In / Out marks (seconds, or null): Lift and Extract act on what lies between them. */
	range: { in: number | null; out: number | null };
	/** Shuttle speed: 1, 2, 4 forward; negative plays backwards (the J key). */
	rate: number;
	help: boolean; // the shortcut sheet
	media: MediaItem[]; // the project's media bin
	uploads: { id: number; name: string; pct: number; error?: string }[];
	dialog: null | 'new-project' | 'project-settings';
	loadMedia: () => Promise<void>;
	uploadFiles: (files: File[]) => Promise<MediaItem[]>;
	createProject: (a: NewProjectArgs, files?: File[]) => Promise<void>;
	init: () => Promise<void>;
	open: (dir: string) => Promise<void>;
	run: (ops: Op[], note?: string, o?: { author?: 'user' | 'ai' }) => Promise<ApplyNote[]>;
	preview: (ops: Op[], label: string) => Promise<void>;
	accept: () => Promise<void>;
	discard: () => void;
	undo: () => Promise<void>;
	redo: () => Promise<void>;
	select: (ids: string[], additive?: boolean) => void;
	set: (p: Partial<State>) => void;
	render: () => Promise<void>;
	replan: () => Promise<void>;
	ask: (text: string, region?: Region | null) => Promise<void>;
	place: (tile: Tile, g: Omit<Geometry, 'time'> & { time?: number }) => Promise<void>;
	design: (brief: string, seconds: number) => Promise<void>;
	refine: (id: string, instruction: string) => Promise<void>;
	saveElement: (name: string, spec: unknown, params: Record<string, unknown>) => Promise<void>;
	addCaptions: (style: Record<string, unknown>, range: 'all' | 'here' | 'next10') => Promise<void>;
}

let nextMsg = 1;

export const useStudio = create<State>((set, get) => ({
	projects: [], dir: null, assetBase: '', edd: null, rev: 0, words: [], report: null, canUndo: false, canRedo: false,
	selection: [], time: 0, playing: false, zoom: 60, status: '', log: '', busy: null, renderOutput: null,
	draft: null, pick: null, region: null, leftTab: 'media', rightTab: 'inspector', msgs: [], guides: false,
	schemas: {}, elements: [], designing: null,
	seekTo: () => {},
	playPause: () => {},
	tool: 'select', range: { in: null, out: null }, rate: 1, help: false,
	media: [], uploads: [], dialog: null,

	set: (p) => set(p),

	loadMedia: async () => {
		const { dir } = get();
		if (!dir) return set({ media: [] });
		try { set({ media: (await api.media(dir)).items }); } catch { set({ media: [] }); }
	},

	/** Upload files into the open project's media bin, one after another, with a progress line each. */
	uploadFiles: async (files) => {
		const { dir } = get();
		if (!dir || !files.length) return [];
		const done: MediaItem[] = [];
		for (const f of files) {
			const id = Date.now() + Math.random();
			set((s) => ({ uploads: [...s.uploads, { id, name: f.name, pct: 0 }] }));
			try {
				done.push(await api.uploadMedia(dir, f, (pct) => set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, pct } : u)) }))));
				set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }));
			} catch (e) {
				set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, error: e instanceof Error ? e.message : String(e) } : u)) }));
			}
		}
		await get().loadMedia();
		return done;
	},

	/** File > New Project: make it, open it, bring in the first footage (which replaces the empty placeholder) and show the Media tab. */
	createProject: async (a, files = []) => {
		const { dir } = await api.newProject(a);
		set({ projects: await api.projects() });
		await get().open(dir);
		set({ leftTab: 'media', dialog: null });
		const items = await get().uploadFiles(files);
		const ops: Op[] = items.filter((i) => i.kind === 'video' || i.kind === 'image').map((i) => ({ op: 'add_footage' as const, src: i.path, duration: i.duration ?? 5, kind: i.kind as 'video' | 'image', has_audio: i.hasAudio }));
		if (ops.length) await get().run(ops, 'footage added');
		set({ status: `Created ${a.name}` });
	},

	init: async () => {
		set({ projects: await api.projects() });
		void api.components().then((schemas) => set({ schemas })).catch(() => undefined);
		void api.elements().then((elements) => set({ elements })).catch(() => undefined);
		subscribe((e) => {
			if (e.type === 'log') set((s) => ({ log: (s.log + e.text).slice(-4000) }));
			if (e.type === 'doc' && e.dir === get().dir && e.rev > get().rev) {
				// A change made by someone else (the AI, a script) shows up live; our own are already applied.
				const sel = get().selection.filter((id) => find(e.edd, id));
				set({ edd: e.edd, rev: e.rev, selection: sel, canUndo: true, status: e.by === 'ai' ? `AI: ${e.note}` : get().status });
			}
		});
		const q = new URLSearchParams(location.search).get('project');
		if (q) await get().open(q);
	},

	open: async (dir) => {
		const o: Opened = await api.open(dir);
		set({ dir: o.dir, edd: o.edd, rev: o.rev, assetBase: o.assetBase, words: o.words, report: o.report, selection: [], time: 0, draft: null, canUndo: o.canUndo > 0, canRedo: o.canRedo > 0, status: `Opened ${dir.split(/[\\/]/).pop()}`, msgs: [] });
		void get().loadMedia();
		const url = new URL(location.href);
		url.searchParams.set('project', dir);
		history.replaceState(null, '', url);
	},

	run: async (ops, note, o) => {
		const { dir } = get();
		if (!dir || !ops.length) return [];
		try {
			const r = await api.ops(dir, ops, { author: o?.author ?? 'user', note });
			set({ edd: r.edd, rev: r.rev, canUndo: r.canUndo > 0, canRedo: r.canRedo > 0, draft: null });
			const bad = r.notes.filter((n) => !n.ok);
			set({ status: bad.length ? `Not applied: ${bad[0].message}` : r.notes[0]?.message ?? 'Done' });
			const made = r.notes.find((n) => n.ok && n.id && ['add_layer', 'add_zoom', 'add_mood', 'add_sfx', 'duplicate', 'split'].includes(n.op.op));
			if (made?.id) set({ selection: [made.id] });
			return r.notes;
		} catch (e) {
			set({ status: `Error: ${e instanceof Error ? e.message : e}` });
			return [];
		}
	},

	preview: async (ops, label) => {
		const { dir } = get();
		if (!dir) return;
		const r = await api.ops(dir, ops, { dryRun: true });
		set({ draft: { edd: r.edd, notes: r.notes, ops, label } });
		const first = r.notes.find((n) => n.ok && n.id);
		const span = first?.id ? spanOf(r.edd, first.id) : null;
		if (span) get().seekTo(Math.max(0, span.start - 0.5));
	},
	accept: async () => {
		const d = get().draft;
		if (!d) return;
		await get().run(d.ops, d.label, { author: 'ai' });
		set((s) => ({ msgs: s.msgs.map((m) => (m.state === 'pending' ? { ...m, state: 'applied' } : m)) }));
	},
	discard: () => set((s) => ({ draft: null, msgs: s.msgs.map((m) => (m.state === 'pending' ? { ...m, state: 'discarded' } : m)) })),

	undo: async () => {
		const { dir } = get();
		if (!dir) return;
		const r = await api.undo(dir);
		set({ status: r.ok ? 'Undone' : 'Nothing to undo' });
		const o = await api.open(dir);
		set({ edd: o.edd, rev: o.rev, canUndo: o.canUndo > 0, canRedo: o.canRedo > 0 });
	},
	redo: async () => {
		const { dir } = get();
		if (!dir) return;
		const r = await api.redo(dir);
		set({ status: r.ok ? 'Redone' : 'Nothing to redo' });
		const o = await api.open(dir);
		set({ edd: o.edd, rev: o.rev, canUndo: o.canUndo > 0, canRedo: o.canRedo > 0 });
	},

	select: (rawIds, additive) =>
		set((s) => {
			const ids = s.edd ? expandGroups(s.edd, rawIds) : rawIds;
			return {
			selection: additive ? (ids.every((i) => s.selection.includes(i)) ? s.selection.filter((i) => !ids.includes(i)) : Array.from(new Set([...s.selection, ...ids]))) : ids,
			rightTab: ids.length && s.rightTab === 'review' ? 'inspector' : s.rightTab,
			};
		}),

	render: async () => {
		const { dir } = get();
		if (!dir) return;
		set({ busy: 'render', log: '', renderOutput: null, status: 'Rendering…' });
		const r = await api.render(dir);
		set({ busy: null, renderOutput: r.output ?? null, status: r.output ? `Rendered ${r.output}` : `Render failed${r.error ? `: ${r.error}` : ''}` });
	},
	replan: async () => {
		const { dir } = get();
		if (!dir) return;
		set({ busy: 'replan', log: '', status: 'AI is re-planning (your edits are kept)…' });
		const r = await api.replan(dir);
		if (r.code === 0) await get().open(dir);
		set({ busy: null, status: r.code === 0 ? 'Re-plan finished. Your edits and locked items were kept.' : `Re-plan failed (${r.error ?? r.code})` });
	},

	place: async (tile, g) => {
		const time = g.time ?? get().time;
		const notes = await get().run([placeOp(tile, { ...g, time })]);
		if (notes.some((n) => n.ok)) set({ pick: null });
	},

	design: async (brief, seconds) => {
		const { dir, region, time } = get();
		if (!dir || !brief.trim()) return;
		set({ designing: brief, status: 'Designing your element…' });
		try {
			const r = await api.design({ dir, brief, region, time, duration: seconds });
			if (r.ok && r.op) {
				await get().preview([r.op], `element: ${brief.slice(0, 60)}`);
				set({ status: `${r.say} (${(r.ms / 1000).toFixed(0)} s, ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}). Apply or discard it, then adjust its settings in the inspector.`, region: null });
			} else set({ status: r.say });
		} catch (e) {
			set({ status: `Couldn't design it: ${e instanceof Error ? e.message : e}` });
		}
		set({ designing: null });
	},

	refine: async (id, instruction) => {
		const { dir, edd, time } = get();
		if (!dir || !edd || !instruction.trim()) return;
		const f = find(edd, id);
		if (!f || f.kind !== 'layer') return;
		const layer = f.layer!;
		set({ designing: instruction, status: 'Updating the element…' });
		try {
			const sp = spanOf(edd, id)!;
			const r = await api.refine({ dir, spec: (layer.props as any).spec, params: (layer.props as any).params ?? {}, instruction, time: sp.start || time, duration: sp.end - sp.start, region: layer.box });
			if (r.ok && r.spec) {
				await get().preview([{ op: 'set_props', id, props: { spec: r.spec, params: r.params ?? {} } }], `change element: ${instruction.slice(0, 60)}`);
				set({ status: `${r.say} Apply or discard it.` });
			} else set({ status: r.say });
		} catch (e) {
			set({ status: `Couldn't change it: ${e instanceof Error ? e.message : e}` });
		}
		set({ designing: null });
	},

	saveElement: async (name, spec, params) => {
		try {
			await api.saveElement(name, spec, params);
			set({ elements: await api.elements(), status: `Saved “${name}” to your elements` });
		} catch (e) {
			set({ status: `Couldn't save: ${e instanceof Error ? e.message : e}` });
		}
	},

	addCaptions: async (style, range) => {
		const { words, time, edd } = get();
		if (!edd || !words.length) { set({ status: 'This project has no transcript to caption' }); return; }
		const total = edd.beats[edd.beats.length - 1].end;
		const [a, b] = range === 'all' ? [0, total] : range === 'here' ? [time, total] : [time, Math.min(total, time + 10)];
		const ws = words.filter((w) => w.end > a && w.start < b).map((w) => ({ text: w.text, start: +w.start.toFixed(2), end: +w.end.toFixed(2) }));
		if (!ws.length) { set({ status: 'No spoken words in that range' }); return; }
		await get().run([{ op: 'add_layer', component: 'Captions', at: a, until: b, props: { ...style, words: ws }, why: 'captions (you added them)' }]);
	},

	ask: async (text, region) => {
		const { dir, time, selection } = get();
		if (!dir) return;
		set((s) => ({ msgs: [...s.msgs, { id: nextMsg++, who: 'you', text }], rightTab: 'assistant' }));
		let rep: AssistantReply;
		try {
			rep = await api.assistant({ dir, message: text, time, selection, region: region ?? undefined });
		} catch (e) {
			set((s) => ({ msgs: [...s.msgs, { id: nextMsg++, who: 'ai', text: `Something went wrong: ${e instanceof Error ? e.message : e}` }] }));
			return;
		}
		const msg: Msg = { id: nextMsg++, who: 'ai', text: rep.reply, ops: rep.ops, options: rep.options, state: rep.ops.length ? 'pending' : undefined, source: rep.source };
		set((s) => ({ msgs: [...s.msgs, msg] }));
		if (rep.ops.length) {
			const r = await api.ops(dir, rep.ops, { dryRun: true });
			set((s) => ({ draft: { edd: r.edd, notes: r.notes, ops: rep.ops, label: text }, msgs: s.msgs.map((m) => (m.id === msg.id ? { ...m, notes: r.notes } : m)) }));
			const first = r.notes.find((n) => n.ok && n.id);
			const span = first?.id ? spanOf(r.edd, first.id) : null;
			if (span) get().seekTo(Math.max(0, span.start - 0.5));
		}
	},
}));

export const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
