/**
 * Element spec: the declarative format an AI (or a person) uses to define a small animated graphic.
 * It is DATA that a safe renderer draws (Element.tsx): no code, scripts, links, styles or external files can be expressed.
 */
import { z } from 'zod';
import { evalExpr, exprNames } from './expr';
import { APPEAR_KINDS, EASES } from './motion';

export const NODE_TYPES = ['rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'text', 'group', 'scene3d'] as const;
export const SHAPES_3D = ['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'plane', 'line', 'label'] as const;
export const ANIM_PROPS = ['rotate', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'opacity', 'draw'] as const;
/** Presentation attributes an element may set. Anything else is rejected. */
export const ATTRS = [
	'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'points',
	'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset', 'opacity', 'fillOpacity', 'strokeOpacity',
	'fontSize', 'fontWeight', 'fontFamily', 'textAnchor', 'dominantBaseline', 'letterSpacing', 'glow', 'transform',
] as const;
export const THEME_TOKENS = ['accent', 'accent2', 'text', 'ink', 'muted', 'white', 'black', 'none'] as const;

const Val = z.union([z.number(), z.string()]); // number, "=expression", "$param", or a literal string
const Key = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'letters, digits, underscore');

export const ParamSpec = z.object({
	key: Key,
	label: z.string().max(40),
	type: z.enum(['number', 'color', 'toggle', 'select', 'text']),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	default: z.union([z.number(), z.string(), z.boolean()]),
	options: z.array(z.string()).max(12).optional(),
});
export type ParamSpec = z.infer<typeof ParamSpec>;

export const AnimSpec = z.object({
	prop: z.string().regex(/^(rotate|translateX|translateY|scale|scaleX|scaleY|opacity|draw|attr:[a-zA-Z]+)$/),
	kind: z.enum(['sin', 'loop', 'pulse', 'ramp', 'once', 'flicker']),
	from: Val.default(0),
	to: Val.default(1),
	period: Val.optional().describe('seconds per cycle (sin, loop, pulse)'),
	duration: Val.optional().describe('seconds (ramp, once)'),
	delay: Val.optional(),
	phase: Val.optional().describe('cycles offset, e.g. 0.25 starts a quarter into the cycle'),
	rate: Val.optional().describe('changes per second (flicker)'),
	ease: z.enum(EASES).optional(),
});
export type AnimSpec = z.infer<typeof AnimSpec>;

/** A staged entrance (and optional exit): the vocabulary of explainers. "at" is seconds since the element appeared. */
export const AppearSpec = z.object({
	at: Val.default(0),
	kind: z.enum(APPEAR_KINDS).default('rise'),
	duration: Val.optional().describe('seconds, default 0.6'),
	until: Val.optional().describe('leaves at this time (the exit is quicker than the entrance)'),
});
export type AppearSpec = z.infer<typeof AppearSpec>;

const Vec3 = z.tuple([Val, Val, Val]);
/** One thing in a 3D scene. x right, y UP, z toward the viewer; `at` is the centre of its base. */
export const Obj3D = z.object({
	shape: z.enum(SHAPES_3D),
	size: z.union([Val, Vec3]).optional().describe('[width, height, depth], or one number for a cube / sphere diameter'),
	at: Vec3.optional(),
	to: Vec3.optional().describe('line: where it ends'),
	rotate: Vec3.optional().describe('degrees about x, y, z'),
	color: z.string().max(40).optional(),
	opacity: Val.optional(),
	text: z.string().max(60).optional().describe('label: the words'),
	fontSize: Val.optional(),
	arrow: z.boolean().optional(),
	width: Val.optional().describe('line thickness'),
	appear: AppearSpec.optional(),
	repeat: z.object({ count: Val }).optional(),
	show: Val.optional(),
});
export type Obj3D = z.infer<typeof Obj3D>;

export interface NodeSpec {
	type: (typeof NODE_TYPES)[number];
	attrs?: Record<string, number | string>;
	text?: string;
	origin?: [number | string, number | string];
	anim?: AnimSpec[];
	appear?: AppearSpec;
	camera?: { yaw?: number | string; pitch?: number | string; zoom?: number | string };
	objects?: Obj3D[];
	repeat?: { count: number | string };
	show?: number | string;
	children?: NodeSpec[];
}
export const NodeSpec: z.ZodType<NodeSpec> = z.lazy(() =>
	z.object({
		type: z.enum(NODE_TYPES),
		attrs: z.record(z.string(), Val).optional(),
		text: z.string().max(80).optional(),
		origin: z.tuple([Val, Val]).optional().describe('pivot for rotate/scale, in viewBox units'),
		anim: z.array(AnimSpec).max(6).optional(),
		appear: AppearSpec.optional(),
		camera: z.object({ yaw: Val.optional(), pitch: Val.optional(), zoom: Val.optional() }).optional().describe('scene3d: orbit camera in degrees; zoom is fitted automatically when left out'),
		objects: z.array(Obj3D).max(60).optional().describe('scene3d: the solids, lines and labels'),
		repeat: z.object({ count: Val }).optional().describe('draw this node count times; i = 0..count-1, n = count'),
		show: Val.optional().describe('expression; the node is drawn only when it is non-zero'),
		children: z.array(NodeSpec).max(60).optional(),
	}),
);

export const ElementSpec = z.object({
	name: z.string().max(60),
	description: z.string().max(240).optional(),
	viewBox: z.tuple([z.number().min(20).max(1000), z.number().min(20).max(1000)]),
	params: z.array(ParamSpec).max(10).default([]),
	nodes: z.array(NodeSpec).min(1).max(60),
});
export type ElementSpec = z.infer<typeof ElementSpec>;

// ------------------------------------------------------------------ validation beyond the schema

export interface SpecIssue { level: 'error' | 'warn'; where: string; message: string }

export const defaultParams = (spec: ElementSpec): Record<string, number | string | boolean> => Object.fromEntries(spec.params.map((p) => [p.key, p.default]));

/** Environment for expressions: numeric params (toggles as 0/1), plus i, n, t. */
export const numericEnv = (spec: ElementSpec, params: Record<string, unknown>, extra: Record<string, number>): Record<string, number> => {
	const env: Record<string, number> = { ...extra };
	for (const p of spec.params) {
		const v = params[p.key] ?? p.default;
		if (typeof v === 'number') env[p.key] = v;
		else if (typeof v === 'boolean') env[p.key] = v ? 1 : 0;
	}
	return env;
};

/** Attributes whose value is a number. A bare formula there ("211-60-i*80") is read as "=211-60-i*80": models forget the "=". */
const NUMERIC_ATTRS = new Set(['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity', 'fontSize', 'letterSpacing', 'glow']);
export function coerceNum(v: number | string): number | string {
	if (typeof v !== 'string') return v;
	const t = v.trim();
	if (t === '' || t.startsWith('=') || t.startsWith('$') || t.includes('{{') || Number.isFinite(Number(t))) return v;
	return `=${t}`;
}
export const coerceAttr = (k: string, v: number | string): number | string => (NUMERIC_ATTRS.has(k) ? coerceNum(v) : v);
const isExpr = (v: unknown): v is string => typeof v === 'string' && v.startsWith('=');
const isParamRef = (v: unknown): v is string => typeof v === 'string' && /^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(v);

/** Count of nodes after `repeat` expansion with default params; caps runaway specs. */
export function expandedCount(spec: ElementSpec): number {
	const env0 = numericEnv(spec, {}, { i: 0, n: 1, t: 0 });
	const count = (nodes: NodeSpec[]): number =>
		nodes.reduce((sum, n) => {
			let times = 1;
			if (n.repeat) {
				try {
					const c = n.repeat.count;
					times = Math.floor(typeof c === 'number' ? c : isExpr(c) ? evalExpr(c.slice(1), env0) : isParamRef(c) ? Number(env0[(c as string).slice(1)] ?? 1) : 1);
				} catch { times = 1; }
			}
			const objs = (n.objects ?? []).reduce((k, o) => {
				let m = 1;
				if (o.repeat) { try { const c = o.repeat.count; m = Math.floor(typeof c === 'number' ? c : isExpr(c) ? evalExpr(c.slice(1), env0) : isParamRef(c) ? Number(env0[(c as string).slice(1)] ?? 1) : 1); } catch { m = 1; } }
				return k + Math.min(60, Math.max(0, m));
			}, 0);
			return sum + Math.min(80, Math.max(0, times)) * (1 + objs + (n.children ? count(n.children) : 0));
		}, 0);
	return count(spec.nodes);
}

/** Static checks on a spec that already passed the schema. Errors must be fixed; warnings are shown. */
export function checkSpec(spec: ElementSpec): SpecIssue[] {
	const issues: SpecIssue[] = [];
	const keys = new Set<string>();
	for (const p of spec.params) {
		if (keys.has(p.key)) issues.push({ level: 'error', where: `params.${p.key}`, message: 'duplicate parameter key' });
		keys.add(p.key);
		if (p.type === 'number' && (typeof p.default !== 'number' || p.min === undefined || p.max === undefined)) issues.push({ level: 'error', where: `params.${p.key}`, message: 'number parameters need numeric default, min and max' });
		if (p.type === 'number' && typeof p.default === 'number' && p.min !== undefined && p.max !== undefined && (p.default < p.min || p.default > p.max)) issues.push({ level: 'error', where: `params.${p.key}`, message: 'default is outside min..max' });
		if (p.type === 'select' && !(p.options?.length)) issues.push({ level: 'error', where: `params.${p.key}`, message: 'select needs options' });
	}
	const names = new Set([...keys, 'i', 'n', 't']);
	const env = numericEnv(spec, {}, { i: 0, n: 1, t: 0 });
	const checkVal = (v: unknown, where: string) => {
		if (isExpr(v)) {
			try {
				for (const nm of exprNames(v.slice(1))) if (!names.has(nm)) issues.push({ level: 'error', where, message: `unknown name "${nm}" in ${v}` });
				for (const t of [0, 0.4, 1, 2.5]) {
					const r = evalExpr(v.slice(1), { ...env, t });
					if (!Number.isFinite(r)) { issues.push({ level: 'error', where, message: `${v} is not a number at t=${t}` }); break; }
				}
			} catch (e) {
				issues.push({ level: 'error', where, message: `${v}: ${e instanceof Error ? e.message : e}` });
			}
		} else if (isParamRef(v) && !keys.has(v.slice(1))) issues.push({ level: 'error', where, message: `unknown parameter ${v}` });
	};
	const holdsText = (n: NodeSpec): boolean => (n.children ?? []).some((c) => c.type === 'text' || holdsText(c));
		let animated = 0;
	let textCount = 0;
	const walk = (nodes: NodeSpec[], path: string) => {
		nodes.forEach((n, idx) => {
			const w = `${path}[${idx}]${n.type}`;
			for (const [k, v] of Object.entries(n.attrs ?? {})) {
				if (!(ATTRS as readonly string[]).includes(k)) issues.push({ level: 'error', where: `${w}.${k}`, message: `attribute "${k}" is not allowed` });
				if (k === 'transform' && typeof v === 'string' && !/^[a-zA-Z0-9 ().,\-]+$/.test(v)) issues.push({ level: 'error', where: `${w}.transform`, message: 'transform has unsafe characters' });
				if (typeof v === 'string' && v.includes('{{')) for (const m of v.matchAll(/\{\{(.+?)\}\}/g)) { const ex = m[1].trim(); if (ex.startsWith('$')) { if (!keys.has(ex.slice(1))) issues.push({ level: 'error', where: `${w}.${k}`, message: `unknown parameter ${ex}` }); } else checkVal(`=${ex}`, `${w}.${k}`); }
				if (k === 'd' && typeof v === 'string' && !v.includes('{{') && !isExpr(v) && !isParamRef(v) && !/^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-eE]+$/.test(v)) issues.push({ level: 'error', where: `${w}.d`, message: 'path data has unexpected characters' });
				if (typeof v === 'string' && /javascript:|url\(|<|>|&#/i.test(v)) issues.push({ level: 'error', where: `${w}.${k}`, message: 'unsafe value' });
				checkVal(coerceAttr(k, v as number | string), `${w}.${k}`);
			}
			if (n.type === 'text') {
				textCount++;
				const bareRef = /^\$+([A-Za-z_]\w*)$/.exec((n.text ?? '').trim());
				const stripped = (n.text ?? '').replace(/\{\{.+?\}\}/g, '');
				if (bareRef) { if (!keys.has(bareRef[1])) issues.push({ level: 'error', where: `${w}.text`, message: `unknown parameter ${bareRef[1]}` }); }
				else if (stripped.includes('$')) issues.push({ level: 'error', where: `${w}.text`, message: 'a "$" in text must be written as {{$paramKey}} for a text parameter' });
				for (const m of (n.text ?? '').matchAll(/\{\{(.+?)\}\}/g)) { const ex = m[1].trim(); if (ex.startsWith('$')) { if (!keys.has(ex.slice(1))) issues.push({ level: 'error', where: `${w}.text`, message: `unknown parameter ${ex}` }); } else checkVal(`=${ex}`, `${w}.text`); }
				const fs = Number(n.attrs?.fontSize);
				if (Number.isFinite(fs) && fs < spec.viewBox[1] * 0.07) issues.push({ level: 'warn', where: `${w}.fontSize`, message: 'text may be too small to read at video size' });
			}
			if (n.appear) { animated++; for (const k of ['at', 'duration', 'until'] as const) if (n.appear[k] !== undefined) checkVal(coerceNum(n.appear[k] as number | string), `${w}.appear.${k}`); }
			if (n.type === 'scene3d') {
				if (!n.objects?.length) issues.push({ level: 'error', where: w, message: 'a scene3d needs an "objects" list (box, cylinder, sphere, …)' });
				const usesT = (v: unknown) => typeof v === 'string' && /(^|[^a-zA-Z_])t([^a-zA-Z_0-9]|$)/.test(v.replace(/^=/, ''));
				for (const k of ['yaw', 'pitch', 'zoom'] as const) { const v = n.camera?.[k]; if (v !== undefined) { checkVal(coerceNum(v), `${w}.camera.${k}`); if (usesT(v)) animated++; } }
				(n.objects ?? []).forEach((o, oi) => {
					const ow = `${w}.objects[${oi}]${o.shape}`;
					const one = (v: unknown, k: string) => { if (v === undefined) return; checkVal(coerceNum(v as number | string), `${ow}.${k}`); if (usesT(v)) animated++; };
					for (const k of ['at', 'to', 'rotate'] as const) (o[k] ?? []).forEach((v, vi) => one(v, `${k}[${vi}]`));
					if (Array.isArray(o.size)) o.size.forEach((v, vi) => one(v, `size[${vi}]`)); else one(o.size, 'size');
					for (const k of ['opacity', 'fontSize', 'width', 'show'] as const) one(o[k], k);
					if (o.repeat) one(o.repeat.count, 'repeat');
					if (o.appear) { animated++; for (const k of ['at', 'duration', 'until'] as const) one(o.appear[k], `appear.${k}`); }
					if (o.color !== undefined) { if (/javascript:|url\(|<|>|&#/i.test(o.color)) issues.push({ level: 'error', where: `${ow}.color`, message: 'unsafe value' }); else if (isParamRef(o.color) && !keys.has(o.color.slice(1))) issues.push({ level: 'error', where: `${ow}.color`, message: `unknown parameter ${o.color}` }); }
					if (o.shape === 'label') {
						textCount++;
						if (!o.text) issues.push({ level: 'error', where: ow, message: 'a label needs "text"' });
						for (const m of (o.text ?? '').matchAll(/\{\{(.+?)\}\}/g)) { const ex = m[1].trim(); if (ex.startsWith('$')) { if (!keys.has(ex.slice(1))) issues.push({ level: 'error', where: `${ow}.text`, message: `unknown parameter ${ex}` }); } else checkVal(`=${ex}`, `${ow}.text`); }
					}
					if (o.shape === 'line' && !o.to) issues.push({ level: 'error', where: ow, message: 'a line needs "to": [x, y, z]' });
					if (o.shape !== 'line' && o.shape !== 'label' && o.size === undefined) issues.push({ level: 'warn', where: ow, message: 'no size given: it is drawn 40 units big' });
				});
			} else if (n.objects || n.camera) issues.push({ level: 'error', where: w, message: '"objects" and "camera" only belong on a node of type "scene3d"' });
			if (n.origin) n.origin.forEach((v, k) => checkVal(coerceNum(v), `${w}.origin[${k}]`));
			if (n.show !== undefined) checkVal(coerceNum(n.show), `${w}.show`);
			if (n.repeat) {
				checkVal(coerceNum(n.repeat.count), `${w}.repeat`);
				const c = n.repeat.count;
				let times = 1;
				try { times = typeof c === 'number' ? c : isExpr(c) ? evalExpr(c.slice(1), env) : isParamRef(c) ? Number(env[(c as string).slice(1)] ?? 1) : 1; } catch { times = 1; }
				if (times > 80) issues.push({ level: 'error', where: `${w}.repeat`, message: `repeat count ${times} is over the limit of 80` });
			}
			for (const a of n.anim ?? []) {
				animated++;
				for (const k of ['from', 'to', 'period', 'duration', 'delay', 'phase', 'rate'] as const) checkVal(coerceNum(a[k] as number | string), `${w}.anim.${a.prop}.${k}`);
				if ((a.kind === 'sin' || a.kind === 'loop' || a.kind === 'pulse') && a.period === undefined) issues.push({ level: 'error', where: `${w}.anim.${a.prop}`, message: `${a.kind} needs a period` });
				if ((a.kind === 'ramp' || a.kind === 'once') && a.duration === undefined) issues.push({ level: 'error', where: `${w}.anim.${a.prop}`, message: `${a.kind} needs a duration` });
				if ((a.prop === 'rotate' || a.prop === 'scale' || a.prop === 'scaleX' || a.prop === 'scaleY') && !n.origin && ['group', 'path', 'polyline', 'polygon'].includes(n.type)) issues.push({ level: 'warn', where: `${w}.anim.${a.prop}`, message: 'no origin set: a group or path then pivots around the middle of the box, which is rarely the hinge you mean' });
			}
			if (n.type === 'text' && (n.anim ?? []).some((a) => a.prop === 'rotate' && a.kind !== 'sin' && a.kind !== 'flicker')) issues.push({ level: 'error', where: w, message: 'text must not spin (it becomes unreadable): rotate only the shapes, keep the words still' });
				if (n.type === 'group' && (n.anim ?? []).some((a) => a.prop === 'rotate' && a.kind !== 'sin') && holdsText(n)) issues.push({ level: 'error', where: w, message: 'this group spins and contains text, so the words would spin too: move the text out into its own node beside the group' });
				if (n.children) walk(n.children, `${w}.`);
		});
	};
	walk(spec.nodes, '');
	if (expandedCount(spec) > 400) issues.push({ level: 'error', where: 'nodes', message: `too many shapes (${expandedCount(spec)} after repeat; limit 400)` });
	if (!animated) issues.push({ level: 'error', where: 'nodes', message: 'nothing moves: add at least one animation' });
	const plates = (function count(ns: NodeSpec[]): number { return ns.reduce((n, x) => n + (x.type === 'group' ? count(x.children ?? []) : x.type !== 'text' && x.attrs?.fill === 'black' && Number(x.attrs?.opacity ?? 1) <= 0.7 ? 1 : 0), 0); })(spec.nodes);
	const shapes = expandedCount(spec) - textCount - plates;
	if (shapes < 3) issues.push({ level: 'warn', where: 'nodes', message: `only ${Math.max(0, shapes)} drawn shape(s): a pictured object (rocket, plant, gauge) usually needs 5 or more parts` });
	if (textCount > 8) issues.push({ level: 'warn', where: 'nodes', message: 'a lot of text for a small element' });
	return issues;
}
