import React, { useMemo } from 'react';
import { random } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../context';
import type { ComponentProps } from '../components/types';
import { evalExpr } from './expr';
import { DUR, appearTransform, easeBy, presence } from './motion';
import { renderScene3d, type SceneTools } from './scene3d';
import { ElementSpec, coerceAttr, coerceNum, defaultParams, numericEnv, type AnimSpec, type NodeSpec } from './spec';

export const GeneratedProps = z.object({
	spec: ElementSpec,
	params: z.record(z.string(), z.unknown()).default({}),
});

type Env = Record<string, number>;
interface Ctx {
	params: Record<string, unknown>;
	base: Env;
	theme: Record<string, string>;
	fonts: Record<string, string>;
	t: number;
	seed: string;
	/** Centre of the viewBox: the fallback pivot for groups/paths with no origin. */
	center: [number, number];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const ease = easeBy;

/** "M {{100 - r}} 50" or "{{round(value)}}%": {{expression}} is a number, {{$name}} a text parameter. */
function template(src: string, env: Env, ctx: Ctx): string {
	// Models often write a bare "$label" or "$$label" for a text parameter; accept it when it names a real one.
	const bare = /^\$+([A-Za-z_]\w*)$/.exec(src.trim());
	if (bare && Object.prototype.hasOwnProperty.call(ctx.params, bare[1])) return String(ctx.params[bare[1]] ?? '');
	return src.replace(/\{\{(.+?)\}\}/g, (_m, ex: string) => {
		const e = ex.trim();
		if (e.startsWith('$')) return String(ctx.params[e.slice(1)] ?? '');
		try { const r = evalExpr(e, env); return Number.isInteger(r) ? String(r) : String(Math.round(r * 100) / 100); } catch { return ''; }
	});
}

/** A value in a spec: number, "=expression", "$param", a theme colour name, or a literal string. */
function val(v: number | string | undefined, env: Env, ctx: Ctx): number | string {
	if (v === undefined) return 0;
	if (typeof v === 'number') return v;
	if (v.startsWith('=')) {
		try { const r = evalExpr(v.slice(1), env); return Number.isFinite(r) ? r : 0; } catch { return 0; }
	}
	if (v.includes('{{')) return template(v, env, ctx);
	if (/^\$[a-zA-Z_]/.test(v)) {
		const p = ctx.params[v.slice(1)];
		return typeof p === 'string' ? (ctx.theme[p] ?? p) : typeof p === 'number' ? p : typeof p === 'boolean' ? (p ? 1 : 0) : 0; // a colour param may hold a theme word ("accent")
	}
	return ctx.theme[v] ?? v;
}
const num = (v: number | string | undefined, env: Env, ctx: Ctx, d = 0): number => {
	const r = v === undefined ? d : val(coerceNum(v), env, ctx);
	return typeof r === 'number' ? r : Number(r) || d;
};

function animValue(a: AnimSpec, env: Env, ctx: Ctx, key: string): number {
	const from = num(a.from, env, ctx, 0);
	const to = num(a.to, env, ctx, 1);
	const delay = num(a.delay, env, ctx, 0);
	const tt = ctx.t - delay;
	switch (a.kind) {
		case 'sin': {
			const period = Math.max(0.05, num(a.period, env, ctx, 1));
			const u = 0.5 + 0.5 * Math.sin(2 * Math.PI * (tt / period + num(a.phase, env, ctx, 0)));
			return from + (to - from) * u;
		}
		case 'loop':
		case 'pulse': {
			const period = Math.max(0.05, num(a.period, env, ctx, 1));
			const raw = tt / period + num(a.phase, env, ctx, 0);
			const u = tt < 0 ? 0 : raw - Math.floor(raw);
			return from + (to - from) * ease(u, a.ease ?? (a.kind === 'pulse' ? 'out' : 'linear'));
		}
		case 'ramp':
		case 'once': {
			const dur = Math.max(0.05, num(a.duration, env, ctx, 1));
			return from + (to - from) * ease(tt / dur, a.ease ?? 'expo');
		}
		case 'flicker': {
			const rate = Math.max(0.5, num(a.rate, env, ctx, 12));
			const step = Math.floor(Math.max(0, tt) * rate);
			return from + (to - from) * random(`${ctx.seed}-${key}-${step}`);
		}
	}
}

const ATTR_NAMES: Record<string, string> = { fontFamily: 'fontFamily' };

function renderNodes(nodes: NodeSpec[], env: Env, ctx: Ctx, path: string): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	nodes.forEach((n, idx) => {
		const times = n.repeat ? Math.min(80, Math.max(0, Math.floor(num(n.repeat.count, env, ctx, 1)))) : 1;
		for (let i = 0; i < times; i++) {
			const e: Env = n.repeat ? { ...env, i, n: times } : env;
			if (n.show !== undefined && !num(n.show, e, ctx, 1)) continue;
			const key = `${path}${idx}.${i}`;
			// A staged entrance: nothing is drawn before its moment, then it eases in (and out again if it has an `until`).
			const pres = n.appear ? presence(ctx.t, num(n.appear.at, e, ctx, 0), num(n.appear.duration, e, ctx, DUR.long), n.appear.until === undefined ? undefined : num(n.appear.until, e, ctx, 0)) : 1;
			if (pres <= 0) continue;
			const ap = n.appear ? appearTransform(n.appear.kind ?? 'rise', pres, Math.min(ctx.center[0], ctx.center[1]) / 100) : null;
			const attrs: Record<string, number | string> = {};
			for (const [k, v] of Object.entries(n.attrs ?? {})) attrs[k] = val(coerceAttr(k, v), e, ctx);

			// animation tracks → transform, opacity, draw, animated attributes
			let tx = 0, ty = 0, rot = 0, sx = 1, sy = 1, op = ap ? ap.opacity : 1, draw: number | null = ap ? ap.draw : null;
			for (const a of n.anim ?? []) {
				const v = animValue(a, e, ctx, key);
				if (a.prop === 'rotate') rot += v;
				else if (a.prop === 'translateX') tx += v;
				else if (a.prop === 'translateY') ty += v;
				else if (a.prop === 'scale') { sx *= v; sy *= v; }
				else if (a.prop === 'scaleX') sx *= v;
				else if (a.prop === 'scaleY') sy *= v;
				else if (a.prop === 'opacity') op *= v;
				else if (a.prop === 'draw') draw = clamp01(v);
				else if (a.prop.startsWith('attr:')) attrs[a.prop.slice(5)] = v;
			}
			// No origin given: pivot about the shape's own centre (a rotate/scale about (0,0) flings it across the box).
				const A = (k: string) => Number(attrs[k]) || 0;
				const own: [number, number] | null =
					n.type === 'rect' ? [A('x') + A('width') / 2, A('y') + A('height') / 2]
					: n.type === 'circle' || n.type === 'ellipse' ? [A('cx'), A('cy')]
					: n.type === 'line' ? [(A('x1') + A('x2')) / 2, (A('y1') + A('y2')) / 2]
					: n.type === 'text' ? [A('x'), A('y')]
					: null;
				const ox = n.origin ? num(n.origin[0], e, ctx) : own ? own[0] : ctx.center[0];
			const oy = n.origin ? num(n.origin[1], e, ctx) : own ? own[1] : ctx.center[1];
			const moves = tx || ty || rot || sx !== 1 || sy !== 1;
			const animT = moves ? `translate(${tx} ${ty}) translate(${ox} ${oy}) rotate(${rot}) scale(${sx} ${sy}) translate(${-ox} ${-oy})` : '';
			// The entrance pivots on the shape itself: its centre, or its bottom edge for "grow" (bars rise from their baseline).
			let appearT = '';
			if (ap && (ap.tx || ap.ty || ap.s !== 1 || ap.sy !== 1)) {
				const px = own ? own[0] : ox;
				const py = ap.sy !== 1 && n.type === 'rect' ? A('y') + A('height') : own ? own[1] : oy;
				appearT = `translate(${ap.tx} ${ap.ty}) translate(${px} ${py}) scale(${ap.s} ${ap.s * ap.sy}) translate(${-px} ${-py})`;
			}
			const staticT = typeof attrs.transform === 'string' ? attrs.transform : '';
			const transform = [appearT, animT, staticT].filter(Boolean).join(' ') || undefined;
			delete attrs.transform;

			const style: React.CSSProperties = {};
			const glow = Number(attrs.glow) || 0;
			delete attrs.glow;
			if (glow > 0) style.filter = `drop-shadow(0 0 ${glow}px ${String(attrs.stroke ?? attrs.fill ?? ctx.theme.accent)})`;
			const baseOpacity = attrs.opacity !== undefined ? Number(attrs.opacity) : 1;
			delete attrs.opacity;
			const common: Record<string, unknown> = { ...attrs, transform, style, opacity: baseOpacity * op };
			if (typeof common.fontFamily === 'string') common.fontFamily = ctx.fonts[common.fontFamily as string] ?? common.fontFamily;
			if (draw !== null) Object.assign(common, { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw });
			void ATTR_NAMES;

			switch (n.type) {
				case 'scene3d': {
					const tools: SceneTools = {
						num: (v, en, d = 0) => num(v, en, ctx, d),
						color: (v, en) => String(val(v, en, ctx)),
						text: (src, en) => template(src, en, ctx),
						ink: ctx.theme.ink, textColor: ctx.theme.text, font: ctx.fonts.display,
					};
					const { x: _x, y: _y, width: _w, height: _h, ...rest } = common as Record<string, unknown>;
					void _x; void _y; void _w; void _h;
					out.push(<g key={key} {...(rest as object)}>{renderScene3d(n, { ...e, t: ctx.t }, tools, key, [ctx.center[0] * 2, ctx.center[1] * 2])}</g>);
					break;
				}
				case 'group': out.push(<g key={key} {...(common as object)}>{renderNodes(n.children ?? [], e, ctx, `${key}.`)}</g>); break;
				case 'text': {
					const txt = template(n.text ?? '', e, ctx);
					// House style: text gets the same dark outline as every other graphic unless the element chose its own stroke.
					if (common.stroke === undefined) Object.assign(common, { stroke: ctx.theme.ink, strokeWidth: Number(common.fontSize ?? 16) * 0.14, paintOrder: 'stroke', strokeLinejoin: 'round' });
					out.push(<text key={key} {...(common as object)}>{txt}</text>);
					break;
				}
				case 'rect': out.push(<rect key={key} {...(common as object)} />); break;
				case 'circle': out.push(<circle key={key} {...(common as object)} />); break;
				case 'ellipse': out.push(<ellipse key={key} {...(common as object)} />); break;
				case 'line': out.push(<line key={key} {...(common as object)} />); break;
				case 'path': out.push(<path key={key} {...(common as object)} />); break;
				case 'polyline': out.push(<polyline key={key} {...(common as object)} />); break;
				case 'polygon': out.push(<polygon key={key} {...(common as object)} />); break;
			}
		}
	});
	return out;
}

/** An element drawn from a spec. Pure function of time and parameters, so renders are deterministic. */
export const Generated: React.FC<ComponentProps<z.infer<typeof GeneratedProps>>> = ({ props, layer, elapsed }) => {
	const { look } = useStudio();
	const spec = props.spec;
	const ctx: Ctx = useMemo(
		() => ({
			params: { ...defaultParams(spec), ...props.params },
			base: {},
			theme: { accent: look.accent, accent2: look.accent2, text: look.text, ink: look.strokeColor, muted: 'rgba(255,255,255,0.55)', white: '#ffffff', black: '#000000', none: 'none' },
			fonts: { display: look.fontDisplay, body: look.fontBody, mono: 'JetBrains Mono' },
			t: 0,
			seed: layer.id, center: [spec.viewBox[0] / 2, spec.viewBox[1] / 2] as [number, number],
		}),
		[spec, props.params, look, layer.id],
	);
	const t = Math.max(0, elapsed);
	const env = numericEnv(spec, ctx.params, { i: 0, n: 1, t });
	return (
		<svg viewBox={`0 0 ${spec.viewBox[0]} ${spec.viewBox[1]}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
			{renderNodes(spec.nodes, env, { ...ctx, t }, '')}
		</svg>
	);
};
