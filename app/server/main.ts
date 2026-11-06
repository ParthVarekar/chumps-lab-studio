/**
 * Chumps Lab Studio server: http://localhost:4173
 *
 * The server owns the live document. The browser editor, the AI assistant and any script (curl, Claude Code) all
 * change an edit the same way: POST /api/ops. Every change is applied by shared/ops.ts, validated, saved with a
 * history record, and pushed to every open editor over /api/events, so what the AI does appears in the editor
 * as it happens.
 *
 * Only listens on 127.0.0.1. /api requests need the X-Studio header and a localhost Origin/Host, so a web page you
 * happen to have open can't drive it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compare } from 'fast-json-patch';
import { Edd } from '@cls/engine/src/edd/schema';
import { z } from 'zod';
import { Op, applyOps, camId, isContinuation, moodId, spanOf, type ApplyNote } from '../shared/ops';
import { assistant } from './assistant';
import { REGISTRY } from '@cls/engine/src/components/registry';
import { designElement, listElements, saveElement } from './elements';
import { loadContext } from './context';
import { LIB, icons, libraryOp, memeCatalog, sfxCatalog } from './library';

const require = createRequire(import.meta.url);
const handler = require('serve-handler');
const { createCore } = require('../electron/core.cjs');

const PORT = Number(process.env.CLS_WEB_PORT || 4173);
const DIST = path.join(import.meta.dirname, '..', 'dist');

// ------------------------------------------------------------------ live documents
interface Doc {
	dir: string;
	edd: Edd;
	rev: number;
	undo: Edd[];
	redo: Edd[];
}
const docs = new Map<string, Doc>();
const clients = new Set<http.ServerResponse>();
const emit = (event: unknown) => clients.forEach((c) => c.write(`data: ${JSON.stringify(event)}\n\n`));

const core = createCore({ onLog: (text: string) => emit({ type: 'log', text }) });

async function openDoc(dirIn: string) {
	const dir = core.safeDir(dirIn);
	const opened = await core.openProject(dir);
	const edd = Edd.parse(opened.edd);
	let doc = docs.get(dir);
	if (!doc) docs.set(dir, (doc = { dir, edd, rev: 1, undo: [], redo: [] }));
	else doc.edd = edd; // disk is the truth when (re)opening (e.g. after an AI re-plan)
	return { opened, doc };
}

function commit(doc: Doc, next: Edd, author: 'user' | 'ai', note: string) {
	const patch = compare(doc.edd, next);
	if (!patch.length) return;
	doc.undo.push(doc.edd);
	if (doc.undo.length > 200) doc.undo.shift();
	doc.redo = [];
	core.saveEdd({ dir: doc.dir, edd: next, patch, author, note });
	doc.edd = next;
	doc.rev++;
	emit({ type: 'doc', dir: doc.dir, rev: doc.rev, edd: next, by: author, note });
}

function stepHistory(doc: Doc, dir: 'undo' | 'redo') {
	const from = dir === 'undo' ? doc.undo : doc.redo;
	const to = dir === 'undo' ? doc.redo : doc.undo;
	const target = from.pop();
	if (!target) return false;
	to.push(doc.edd);
	core.saveEdd({ dir: doc.dir, edd: target, patch: compare(doc.edd, target), author: 'user', note: dir });
	doc.edd = target;
	doc.rev++;
	emit({ type: 'doc', dir: doc.dir, rev: doc.rev, edd: target, by: 'user', note: dir });
	return true;
}

// ------------------------------------------------------------------ library (sound effects, memes, icons): see library.ts
/** The command that puts a designed element on screen (in the zoom-aware space, so it follows the camera). */
export function elementOp(spec: unknown, params: Record<string, unknown>, region: { x: number; y: number; w: number; h: number } | null, at: number, seconds: number, why: string): Op {
	return { op: 'add_layer', component: 'Generated', at, until: at + seconds, props: { spec, params }, box: region ?? { x: 38, y: 26, w: 24, h: 42.7 }, space: 'stage', why };
}

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

function waveform(dir: string): number[] {
	const cache = path.join(dir, 'analysis', 'waveform.json');
	if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
	const src = path.join(dir, 'media', 'narration_16k.wav');
	if (!existsSync(src)) return [];
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '2000', '-f', 'f32le', '-'], { maxBuffer: 200e6 });
	const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
	const per = 100; // 20 peaks per second
	const peaks: number[] = [];
	for (let i = 0; i < f.length; i += per) {
		let m = 0;
		for (let j = i; j < Math.min(f.length, i + per); j++) m = Math.max(m, Math.abs(f[j]));
		peaks.push(Math.round(m * 100) / 100);
	}
	mkdirSync(path.dirname(cache), { recursive: true });
	writeFileSync(cache, JSON.stringify(peaks));
	return peaks;
}

// ------------------------------------------------------------------ routes
const localhost = (h?: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h ?? '');
const readBody = (req: http.IncomingMessage) =>
	new Promise<any>((resolve, reject) => {
		let body = '';
		req.on('data', (c) => {
			body += c;
			if (body.length > 50e6) reject(new Error('body too large'));
		});
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (e) {
				reject(e);
			}
		});
	});

type Handler = (body: any, url: URL) => unknown | Promise<unknown>;
const routes: Record<string, Handler> = {
	'GET /api/projects': () => core.listProjects(),

	'POST /api/open': async (b) => {
		const { opened, doc } = await openDoc(b.dir);
		const ctx = loadContext(doc.dir);
		return { dir: doc.dir, edd: doc.edd, rev: doc.rev, report: opened.report, assetBase: opened.assetBase, history: opened.history, words: ctx.words, canUndo: doc.undo.length, canRedo: doc.redo.length };
	},

	// The one door every change goes through (UI, AI, scripts).
	'POST /api/ops': async (b) => {
		const { doc } = await openDoc(b.dir).then((r) => ({ doc: docs.get(core.safeDir(b.dir)) ?? r.doc }));
		const ops = (b.ops as unknown[]).map((o) => Op.parse(o));
		const author: 'user' | 'ai' = b.author === 'ai' ? 'ai' : 'user';
		const res = applyOps(doc.edd, ops, author);
		const applied = res.notes.filter((n: ApplyNote) => n.ok).length;
		if (!b.dryRun && applied) commit(doc, res.edd, author, b.note ?? res.notes.filter((n: ApplyNote) => n.ok).map((n: ApplyNote) => n.message).join('; '));
		return { edd: res.edd, notes: res.notes, rev: doc.rev, applied, dryRun: !!b.dryRun, canUndo: doc.undo.length, canRedo: doc.redo.length };
	},

	'POST /api/undo': (b) => {
		const doc = docs.get(core.safeDir(b.dir));
		return { ok: !!doc && stepHistory(doc, 'undo'), rev: doc?.rev };
	},
	'POST /api/redo': (b) => {
		const doc = docs.get(core.safeDir(b.dir));
		return { ok: !!doc && stepHistory(doc, 'redo'), rev: doc?.rev };
	},

	// For AI clients: what commands exist (JSON Schema) and what is in the edit right now (ids you can pass to those commands).
	'GET /api/ops-schema': () => z.toJSONSchema(Op, { target: 'draft-7' }),
	'GET /api/items': (_b, url) => {
		const dir = core.safeDir(url.searchParams.get('dir') ?? '');
		const doc = docs.get(dir);
		if (!doc) throw new Error('open the project first (POST /api/open)');
		const e = doc.edd;
		const out: unknown[] = [];
		const seen = new Set<string>();
		for (const b of e.beats) {
			for (const l of b.layers) {
				if (isContinuation(l) || seen.has(l.id)) continue;
				seen.add(l.id);
				const sp = spanOf(e, l.id)!;
				out.push({ id: l.id, type: l.component, text: l.props.text ?? l.props.label ?? undefined, start: sp.start, end: sp.end, space: l.space, box: l.box, origin: l.meta.origin, locked: l.meta.locked, group: l.meta.group, disabled: l.meta.disabled, why: l.meta.reason });
			}
			b.camera.forEach((c, i) => { const id = camId(b, i); const sp = spanOf(e, id)!; out.push({ id, type: 'zoom', start: sp.start, end: sp.end, to: c.to, origin: c.meta.origin, locked: c.meta.locked, group: c.meta.group, disabled: c.meta.disabled, why: c.meta.reason }); });
			b.moods.forEach((m, i) => { const id = moodId(b, i); const sp = spanOf(e, id)!; out.push({ id, type: `mood:${m.kind}`, start: sp.start, end: sp.end, origin: m.meta.origin, locked: m.meta.locked }); });
		}
		for (const s of e.audio.sfx) out.push({ id: s.id, type: 'sound', role: s.role, start: s.at, volume: s.volume, origin: s.meta.origin, locked: s.meta.locked });
		return { rev: doc.rev, duration: e.beats[e.beats.length - 1].end, items: (out as { start: number }[]).sort((a, z2) => a.start - z2.start) };
	},
	// Props schema of every component, so the inspector can build real controls (dropdowns, sliders) for any of them.
	'GET /api/components': () => Object.fromEntries(Object.entries(REGISTRY).map(([k, d]) => [k, { description: d.description, space: d.space ?? 'screen', schema: z.toJSONSchema(d.props, { target: 'draft-7', unrepresentable: 'any' }) }])),

	// Animated elements: gallery, AI designer, refine, save.
	'GET /api/elements': () => listElements(),
	'POST /api/elements/design': async (b) => {
		const dir = core.safeDir(b.dir);
		const res = await designElement({ dir, brief: String(b.brief ?? ''), region: b.region ?? null, time: Number(b.time ?? 0), duration: Number(b.duration ?? 3) });
		return { ...res, op: res.ok && res.spec ? elementOp(res.spec, res.params ?? {}, b.region ?? null, Number(b.time ?? 0), Number(b.duration ?? 3), `designed for: ${String(b.brief).slice(0, 80)}`) : null };
	},
	'POST /api/elements/refine': async (b) => {
		const dir = core.safeDir(b.dir);
		const spec = (await import('@cls/engine/src/element/spec')).ElementSpec.parse(b.spec);
		const res = await designElement({ dir, brief: String(b.brief ?? spec.name), region: b.region ?? null, time: Number(b.time ?? 0), duration: Number(b.duration ?? 3), current: { spec, params: b.params ?? {} }, instruction: String(b.instruction ?? '') });
		return res;
	},
	'POST /api/elements/save': (b) => saveElement(String(b.name ?? 'element'), b.spec, b.params ?? {}),

	'GET /api/library': () => ({ sfx: sfxCatalog(), memes: memeCatalog() }),
	'GET /api/icons': (_b, url) => {
		const q = (url.searchParams.get('q') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
		const ids = Object.keys(icons().icons);
		return (q ? ids.filter((i) => i.includes(q)) : ids.slice(0, 60)).slice(0, 60).map((id) => ({ id, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icons().icons[id].width ?? 24} ${icons().icons[id].height ?? 24}">${icons().icons[id].body.replace(/currentColor/g, '#ffffff')}</svg>` }));
	},
	'POST /api/library/add': async (b) => {
		const dir = core.safeDir(b.dir);
		const doc = docs.get(dir) ?? (await openDoc(dir)).doc;
		const op = libraryOp(dir, b);
		const res = applyOps(doc.edd, [op], 'user');
		if (res.notes[0].ok) commit(doc, res.edd, 'user', res.notes[0].message);
		return { notes: res.notes, rev: doc.rev, id: res.notes[0].id };
	},
	'GET /api/waveform': (_b, url) => waveform(core.safeDir(url.searchParams.get('dir') ?? '')),

	'POST /api/render': (b) => core.startRender(b.dir),
	'POST /api/replan': async (b) => {
		const r = await core.startReplan(b.dir);
		if (r.code === 0) {
			const { doc } = await openDoc(b.dir);
			emit({ type: 'doc', dir: doc.dir, rev: ++doc.rev, edd: doc.edd, by: 'ai', note: 're-plan' });
		}
		return r;
	},

	// Chat: a request in plain English → commands. The model only answers; applying (or previewing) goes through /api/ops.
	'POST /api/assistant': async (b) => {
		const dir = core.safeDir(b.dir);
		const doc = docs.get(dir) ?? (await openDoc(dir)).doc;
		return assistant({ dir, edd: doc.edd, message: String(b.message ?? ''), time: Number(b.time ?? 0), selection: (b.selection as string[]) ?? [], region: b.region });
	},
};

http
	.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (url.pathname.startsWith('/api/')) {
			const origin = req.headers.origin;
			if (!localhost(req.headers.host) || (origin && !localhost(new URL(origin).host)) || req.headers['x-studio'] !== '1') {
				res.writeHead(403).end('forbidden');
				return;
			}
			if (url.pathname === '/api/events') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
				res.write(': connected\n\n');
				clients.add(res);
				req.on('close', () => clients.delete(res));
				return;
			}
			const route = routes[`${req.method} ${url.pathname}`];
			if (!route) {
				res.writeHead(404).end('not found');
				return;
			}
			try {
				const result = await route(req.method === 'POST' ? await readBody(req) : {}, url);
				res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? null));
			} catch (e) {
				res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
			}
			return;
		}
		// Library files (for auditioning sounds): GET /library/<path> — only inside the library folder.
		if (url.pathname.startsWith('/library/')) {
			const file = path.resolve(LIB, decodeURIComponent(url.pathname.slice('/library/'.length)));
			if (!file.startsWith(LIB + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, { 'Content-Type': file.endsWith('.wav') ? 'audio/wav' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
			res.end(readFileSync(file));
			return;
		}
		// cleanUrls off: serve-handler otherwise redirects /index.html?… to / and drops the query string.
		handler(req, res, { public: DIST, directoryListing: false, cleanUrls: false });
	})
	.listen(PORT, '127.0.0.1', () => console.log(`Chumps Lab Studio: http://localhost:${PORT}  (projects: ${core.PROJECTS})`));

