/**
 * A small 3D scene drawn as SVG: solids are meshed, turned by an orbit camera, flat-shaded and painted back to front.
 *
 * Why not WebGL: an element must stay DATA a weak local model can write and code can check, render identically in the
 * editor preview and in the final render, and need no GPU (the GPU is busy running the model). An orthographic,
 * flat-shaded look is also what explainer graphics want. Coordinates: x right, y UP, z toward the viewer; an object's
 * `at` is the centre of its BASE (where it stands), so stacking is `y = i * height`.
 */
import React from 'react';
import { APPEAR_KINDS, DUR, presence, type AppearKind } from './motion';
import type { NodeSpec, Obj3D } from './spec';

type V3 = [number, number, number];
type Env = Record<string, number>;
type Val = number | string | undefined;

export interface SceneTools {
	num: (v: Val, env: Env, d?: number) => number;
	color: (v: string | undefined, env: Env) => string;
	text: (src: string, env: Env) => string;
	ink: string;
	textColor: string;
	font: string;
}

const rad = (d: number) => (d * Math.PI) / 180;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const centroid = (p: V3[]): V3 => { const s: V3 = [0, 0, 0]; for (const v of p) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; } return [s[0] / p.length, s[1] / p.length, s[2] / p.length]; };
const rotX = (p: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const rotY = (p: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const rotZ = (p: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };

const LIGHT = norm([-0.45, 0.8, 0.4]);
const SIDES = 24;

// ------------------------------------------------------------------ meshes (local space, base centre at the origin)
interface Mesh { faces: V3[][]; smooth: boolean[]; centre: V3 }

function ring(rx: number, rz: number, y: number, n = SIDES): V3[] {
	return Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n; return [Math.cos(a) * rx, y, Math.sin(a) * rz] as V3; });
}

function mesh(shape: Obj3D['shape'], w: number, h: number, d: number): Mesh {
	const faces: V3[][] = [];
	const smooth: boolean[] = [];
	const add = (f: V3[], s = false) => { faces.push(f); smooth.push(s); };
	const x = w / 2, z = d / 2;
	switch (shape) {
		case 'box': {
			const v: V3[] = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]];
			for (const q of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) add(q.map((k) => v[k]));
			break;
		}
		case 'pyramid': {
			const b: V3[] = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]];
			add(b);
			for (let k = 0; k < 4; k++) add([b[k], b[(k + 1) % 4], [0, h, 0]]);
			break;
		}
		case 'cylinder': {
			const lo = ring(x, z, 0), hi = ring(x, z, h);
			add(lo); add(hi);
			for (let k = 0; k < SIDES; k++) add([lo[k], lo[(k + 1) % SIDES], hi[(k + 1) % SIDES], hi[k]], true);
			break;
		}
		case 'cone': {
			const lo = ring(x, z, 0);
			add(lo);
			for (let k = 0; k < SIDES; k++) add([lo[k], lo[(k + 1) % SIDES], [0, h, 0]], true);
			break;
		}
		case 'sphere': {
			const LAT = 9, LON = 16, ry = h / 2;
			const pt = (i: number, j: number): V3 => { const th = (Math.PI * i) / LAT, ph = (2 * Math.PI * j) / LON; return [Math.sin(th) * Math.cos(ph) * x, ry + Math.cos(th) * ry, Math.sin(th) * Math.sin(ph) * z]; };
			for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
				const q = i === 0 ? [pt(0, j), pt(1, j), pt(1, j + 1)] : i === LAT - 1 ? [pt(i, j), pt(LAT, j), pt(i, j + 1)] : [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
				add(q, true);
			}
			break;
		}
		case 'plane': add([[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]]); break;
		default: break;
	}
	return { faces, smooth, centre: [0, shape === 'plane' ? 0 : h / 2, 0] };
}

// ------------------------------------------------------------------ colour
function rgbOf(css: string): [number, number, number] {
	const s = css.trim().toLowerCase();
	let m = /^#([0-9a-f]{3})$/.exec(s);
	if (m) return [0, 1, 2].map((k) => parseInt(m![1][k] + m![1][k], 16)) as [number, number, number];
	m = /^#([0-9a-f]{6})/.exec(s);
	if (m) return [0, 2, 4].map((k) => parseInt(m![1].slice(k, k + 2), 16)) as [number, number, number];
	m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s);
	if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
	return s === 'white' ? [255, 255, 255] : s === 'black' ? [0, 0, 0] : [200, 200, 200];
}
const shade = (c: [number, number, number], k: number) => `rgb(${c.map((v) => Math.round(Math.min(255, v * k))).join(',')})`;

// ------------------------------------------------------------------ objects → world space
interface Placed { obj: Obj3D; env: Env; p: number; kind: AppearKind; faces: V3[][]; smooth: boolean[]; centre: V3; a: V3; b: V3 }

const vec = (v: Obj3D['at'], env: Env, t: SceneTools, d: V3 = [0, 0, 0]): V3 => (v ? [t.num(v[0], env, d[0]), t.num(v[1], env, d[1]), t.num(v[2], env, d[2])] : d);

function sizeOf(o: Obj3D, env: Env, t: SceneTools): V3 {
	const s = o.size;
	if (Array.isArray(s)) return [Math.abs(t.num(s[0], env, 40)), Math.abs(t.num(s[1], env, 40)), Math.abs(t.num(s[2], env, 40))];
	const one = Math.abs(t.num(s as Val, env, 40));
	return [one, one, one];
}

/** Every object (after `repeat`), meshed and moved to where it is at this moment. `settled` ignores entrances (used for fitting). */
function place(node: NodeSpec, env: Env, tools: SceneTools, settled: boolean): Placed[] {
	const out: Placed[] = [];
	for (const o of node.objects ?? []) {
		const times = o.repeat ? Math.min(60, Math.max(0, Math.floor(tools.num(o.repeat.count, env, 1)))) : 1;
		for (let i = 0; i < times; i++) {
			const e: Env = o.repeat ? { ...env, i, n: times } : env;
			if (o.show !== undefined && !tools.num(o.show, e, 1)) continue;
			const kind = (APPEAR_KINDS as readonly string[]).includes(o.appear?.kind ?? '') ? (o.appear!.kind as AppearKind) : 'pop';
			const p = settled || !o.appear ? 1 : presence(e.t ?? 0, tools.num(o.appear.at, e, 0), tools.num(o.appear.duration, e, DUR.long), o.appear.until === undefined ? undefined : tools.num(o.appear.until, e, 0));
			if (p <= 0) continue;
			const at = vec(o.at, e, tools);
			const off: V3 = kind === 'rise' ? [0, -(1 - p) * 14, 0] : kind === 'drop' ? [0, (1 - p) * 46, 0] : kind === 'slide-left' ? [(1 - p) * 46, 0, 0] : kind === 'slide-right' ? [-(1 - p) * 46, 0, 0] : [0, 0, 0];
			const base: V3 = [at[0] + off[0], at[1] + off[1], at[2] + off[2]];
			if (o.shape === 'line' || o.shape === 'label') {
				const to = vec(o.to, e, tools, at);
				const q = kind === 'draw' ? p : 1;
				out.push({ obj: o, env: e, p, kind, faces: [], smooth: [], centre: base, a: base, b: [base[0] + (to[0] - at[0]) * q, base[1] + (to[1] - at[1]) * q, base[2] + (to[2] - at[2]) * q] });
				continue;
			}
			const [w, h, d] = sizeOf(o, e, tools);
			const m = mesh(o.shape, w, h, d);
			const sc: V3 = kind === 'pop' ? [0.6 + 0.4 * p, 0.6 + 0.4 * p, 0.6 + 0.4 * p] : kind === 'grow' ? [1, Math.max(0.001, p), 1] : [1, 1, 1];
			const r = vec(o.rotate, e, tools).map(rad) as V3;
			const move = (v: V3): V3 => {
				let q: V3 = [v[0] * sc[0], v[1] * sc[1], v[2] * sc[2]];
				q = rotZ(rotY(rotX(q, r[0]), r[1]), r[2]);
				return [q[0] + base[0], q[1] + base[1], q[2] + base[2]];
			};
			out.push({ obj: o, env: e, p, kind, faces: m.faces.map((f) => f.map(move)), smooth: m.smooth, centre: move(m.centre), a: base, b: base });
		}
	}
	return out;
}

// ------------------------------------------------------------------ fitting: one scale for the whole animation
interface Fit { c: V3; zoom: number; mx: number; my: number; r: number }
const fits = new WeakMap<object, Map<string, Fit>>();
const FIT_TIMES = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24];

/**
 * Scale and centre so the scene fills its viewport whatever units the author used. Things move (orbits, growth, a turning
 * camera), so the outline is measured as seen through the camera at several moments and the frame holds all of them.
 */
function fit(node: NodeSpec, env: Env, tools: SceneTools, W: number, H: number): Fit {
	const key = JSON.stringify([W, H, Object.entries(env).filter(([k]) => k !== 't' && k !== 'i' && k !== 'n')]);
	let cache = fits.get(node);
	if (!cache) fits.set(node, (cache = new Map()));
	const hit = cache.get(key);
	if (hit) return hit;
	const samples = FIT_TIMES.map((t) => {
		const e = { ...env, t };
		const pts: V3[] = [];
		for (const pl of place(node, e, tools, true)) { for (const f of pl.faces) pts.push(...f); if (!pl.faces.length) pts.push(pl.a, pl.b); }
		return { pts, yaw: rad(tools.num(node.camera?.yaw, e, 35)), pitch: rad(tools.num(node.camera?.pitch, e, 24)) };
	});
	const all = samples.flatMap((x) => x.pts);
	if (!all.length) all.push([0, 0, 0]);
	const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (const q of all) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
	const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const sm of samples) for (const q of sm.pts) { const v = rotX(rotY(sub(q, c), sm.yaw), sm.pitch); x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
	if (!Number.isFinite(x0)) { x0 = y0 = -1; x1 = y1 = 1; }
	const res: Fit = { c, zoom: 0.86 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0)), mx: (x0 + x1) / 2, my: (y0 + y1) / 2, r: Math.max(1, ...all.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]))) };
	cache.set(key, res);
	return res;
}

/** How many solids / lines / labels the scene draws with these settings (for budgets and checks). */
export function sceneObjectCount(node: NodeSpec, env: Env, num: SceneTools['num']): number {
	return (node.objects ?? []).reduce((sum, o) => sum + (o.repeat ? Math.min(60, Math.max(0, Math.floor(num(o.repeat.count, env, 1)))) : 1), 0);
}

// ------------------------------------------------------------------ draw
export function renderScene3d(node: NodeSpec, env: Env, tools: SceneTools, key: string, viewBox: [number, number]): React.ReactNode[] {
	const x0 = tools.num(node.attrs?.x as Val, env, 0), y0 = tools.num(node.attrs?.y as Val, env, 0);
	const W = tools.num(node.attrs?.width as Val, env, viewBox[0]) || viewBox[0], H = tools.num(node.attrs?.height as Val, env, viewBox[1]) || viewBox[1];
	const cx = x0 + W / 2, cy = y0 + H / 2;
	const { c, r, zoom: fitted, mx, my } = fit(node, env, tools, W, H);
	// camera.zoom is a multiplier on the fitted size (1 = fills the viewport), so a wrong guess can never lose the scene.
	const zoom = fitted * Math.min(4, Math.max(0.2, node.camera?.zoom !== undefined ? tools.num(node.camera.zoom, env, 1) : 1));
	const yaw = rad(tools.num(node.camera?.yaw, env, 35)), pitch = rad(tools.num(node.camera?.pitch, env, 24));
	const cam = (p: V3): V3 => rotX(rotY(sub(p, c), yaw), pitch);
	const scr = (p: V3): [number, number] => [cx + (p[0] - mx) * zoom, cy - (p[1] - my) * zoom];
	const unit = Math.min(viewBox[0], viewBox[1]) / 200;

	const items: { depth: number; el: React.ReactNode }[] = [];
	let n = 0;
	for (const pl of place(node, env, tools, false)) {
		const o = pl.obj;
		const fade = pl.kind === 'grow' ? Math.min(1, pl.p * 4) : pl.kind === 'draw' ? 1 : pl.p;
		const alpha = Math.max(0, Math.min(1, fade * (o.opacity === undefined ? 1 : tools.num(o.opacity, pl.env, 1))));
		const css = tools.color(o.color ?? (o.shape === 'plane' ? 'muted' : o.shape === 'label' ? 'text' : 'accent'), pl.env);
		if (o.shape === 'label') {
			const [sx, sy] = scr(cam(pl.a));
			const fs = tools.num(o.fontSize, pl.env, 16 * unit);
			items.push({ depth: Infinity, el: <text key={`${key}l${n++}`} x={sx} y={sy} fontSize={fs} fontFamily={tools.font} fontWeight={800} textAnchor="middle" dominantBaseline="middle" fill={css} stroke={tools.ink} strokeWidth={fs * 0.16} paintOrder="stroke" strokeLinejoin="round" opacity={alpha}>{tools.text(o.text ?? '', pl.env)}</text> });
			continue;
		}
		if (o.shape === 'line') {
			const A = cam(pl.a), B = cam(pl.b);
			const [ax, ay] = scr(A), [bx, by] = scr(B);
			const sw = tools.num(o.width, pl.env, 3.5 * unit);
			const len = Math.hypot(bx - ax, by - ay);
			const head = o.arrow && len > sw * 3 ? (() => { const ux = (bx - ax) / len, uy = (by - ay) / len, s = sw * 2.6; return `${bx},${by} ${bx - ux * s * 1.5 - uy * s * 0.8},${by - uy * s * 1.5 + ux * s * 0.8} ${bx - ux * s * 1.5 + uy * s * 0.8},${by - uy * s * 1.5 - ux * s * 0.8}`; })() : null;
			items.push({ depth: (A[2] + B[2]) / 2 + r * 0.05, el: <g key={`${key}n${n++}`} opacity={alpha}><line x1={ax} y1={ay} x2={head ? bx - ((bx - ax) / len) * sw * 2.6 : bx} y2={head ? by - ((by - ay) / len) * sw * 2.6 : by} stroke={css} strokeWidth={sw} strokeLinecap="round" />{head ? <polygon points={head} fill={css} /> : null}</g> });
			continue;
		}
		const rgb = rgbOf(css);
		pl.faces.forEach((f, k) => {
			// Outward normal: flip the winding when it points at the object's own centre (meshes above are convex).
			let nrm = norm(cross(sub(f[1], f[0]), sub(f[2], f[0])));
			const ctr = centroid(f);
			if (o.shape !== 'plane' && dot(nrm, sub(ctr, pl.centre)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
			const nc = rotX(rotY(nrm, yaw), pitch);
			if (o.shape !== 'plane' && nc[2] <= 1e-4) return; // faces away from the camera
			const fill = shade(rgb, 0.52 + 0.48 * Math.max(0, o.shape === 'plane' ? Math.abs(dot(nrm, LIGHT)) : dot(nrm, LIGHT)) + (nrm[1] > 0.9 ? 0.06 : 0));
			const pts = f.map((v) => scr(cam(v)).map((q) => Math.round(q * 100) / 100).join(',')).join(' ');
			const soft = pl.smooth[k];
			items.push({
				depth: o.shape === 'plane' ? -Infinity : cam(ctr)[2],
				el: <polygon key={`${key}f${n++}`} points={pts} fill={fill} stroke={soft ? fill : tools.ink} strokeWidth={soft ? 0.7 * unit : 1.6 * unit} strokeLinejoin="round" opacity={alpha} />,
			});
		});
	}
	// Painter's algorithm: far things first. Labels (depth Infinity) always end up on top so they stay readable.
	items.sort((a, z) => (a.depth === z.depth ? 0 : a.depth < z.depth ? -1 : 1));
	return items.map((it) => it.el);
}
