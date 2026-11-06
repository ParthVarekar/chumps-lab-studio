/**
 * Element spec: the declarative format an AI (or a person) uses to define a small animated graphic.
 * It is DATA that a safe renderer draws (Element.tsx): no code, scripts, links, styles or external files can be expressed.
 */
import { z } from 'zod';
import { evalExpr, exprNames } from './expr';

export const NODE_TYPES = ['rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'text', 'group'] as const;
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
	ease: z.enum(['linear', 'in', 'out', 'inout', 'spring', 'back']).optional(),
});
export type AnimSpec = z.infer<typeof AnimSpec>;

export interface NodeSpec {
	type: (typeof NODE_TYPES)[number];
	attrs?: Record<string, number | string>;
	text?: string;
	origin?: [number | string, number | string];
	anim?: AnimSpec[];
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
			return sum + Math.min(80, Math.max(0, times)) * (1 + (n.children ? count(n.children) : 0));
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
