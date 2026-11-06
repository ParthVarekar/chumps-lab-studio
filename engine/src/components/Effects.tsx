/**
 * Effects, transitions and captions: the things you drop on the picture (blueprint "Effects" shelf).
 * Region effects (Highlight, Spotlight, Blur, Arrow, ClickRipple) fill the layer's box; moment effects (Flash, FadeBlack,
 * Wipe, Glitch, Vignette, Letterbox) are full-frame and time themselves over the layer's visible length.
 * Each animates itself from `elapsed`, so give them the 'cut' entrance.
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, random, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../context';
import type { Look } from '../look/looks';
import type { ComponentProps } from './types';

const tone = (look: Look, c: string): string => ({ text: look.text, accent: look.accent, accent2: look.accent2, ink: look.strokeColor, white: '#ffffff', black: '#000000' } as Record<string, string>)[c] ?? c;
const out = Easing.out(Easing.cubic);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const grow = (elapsed: number, secs: number) => out(clamp01(elapsed / secs));

// ---------------------------------------------------------------- region effects
export const HighlightProps = z.object({
	shape: z.enum(['box', 'ellipse', 'underline']).default('box'),
	color: z.string().default('accent'),
	thickness: z.number().min(1).max(30).default(6).describe('line width in px at 1080p'),
	fill: z.number().min(0).max(0.6).default(0).describe('tint inside the shape'),
	pulse: z.boolean().default(false),
});
export const Highlight: React.FC<ComponentProps<z.infer<typeof HighlightProps>>> = ({ props, layer, elapsed }) => {
	const { look } = useStudio();
	const { width: W, height: H } = useVideoConfig();
	const w = (layer.box.w / 100) * W;
	const h = (layer.box.h / 100) * H;
	const th = props.thickness * (H / 1080);
	const c = tone(look, props.color);
	const d = grow(elapsed, 0.35);
	const pulse = props.pulse ? 1 + 0.03 * Math.sin(elapsed * 7) : 1;
	const common = { fill: 'none', pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - d, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
	const pad = th;
	return (
		<svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', transform: `scale(${pulse})` }}>
			{props.shape === 'underline' ? (
				<>
					<path d={`M ${pad} ${h - pad} Q ${w * 0.12} ${h - pad * 3} ${w * 0.25} ${h - pad} T ${w * 0.5} ${h - pad} T ${w * 0.75} ${h - pad} T ${w - pad} ${h - pad}`} {...common} stroke={look.strokeColor} strokeWidth={th * 1.9} />
					<path d={`M ${pad} ${h - pad} Q ${w * 0.12} ${h - pad * 3} ${w * 0.25} ${h - pad} T ${w * 0.5} ${h - pad} T ${w * 0.75} ${h - pad} T ${w - pad} ${h - pad}`} {...common} stroke={c} strokeWidth={th} />
				</>
			) : props.shape === 'ellipse' ? (
				<>
					{props.fill > 0 ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={c} opacity={props.fill * d} /> : null}
					<ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} stroke={look.strokeColor} strokeWidth={th * 1.9} />
					<ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} stroke={c} strokeWidth={th} />
				</>
			) : (
				<>
					{props.fill > 0 ? <rect x={0} y={0} width={w} height={h} rx={th * 1.2} fill={c} opacity={props.fill * d} /> : null}
					<rect x={0} y={0} width={w} height={h} rx={th * 1.2} {...common} stroke={look.strokeColor} strokeWidth={th * 1.9} />
					<rect x={0} y={0} width={w} height={h} rx={th * 1.2} {...common} stroke={c} strokeWidth={th} />
				</>
			)}
		</svg>
	);
};

export const SpotlightProps = z.object({
	dim: z.number().min(0.1).max(0.95).default(0.65).describe('how dark everything else gets'),
	shape: z.enum(['box', 'ellipse']).default('box'),
	ring: z.boolean().default(true).describe('thin accent outline around the lit area'),
});
export const Spotlight: React.FC<ComponentProps<z.infer<typeof SpotlightProps>>> = ({ props, elapsed }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	const k = grow(elapsed, 0.3);
	return (
		<div style={{ width: '100%', height: '100%', borderRadius: props.shape === 'ellipse' ? '50%' : 0.012 * H, boxShadow: `0 0 0 4000px rgba(0,0,0,${props.dim * k})`, outline: props.ring ? `${Math.max(2, H * 0.004)}px solid ${look.accent}` : undefined, outlineOffset: 0, opacity: 1 }} />
	);
};

export const BlurRegionProps = z.object({
	mode: z.enum(['blur', 'frost', 'blackout']).default('blur').describe('blur or frost hide text; blackout is solid'),
	amount: z.number().min(2).max(60).default(22).describe('blur radius in px at 1080p'),
	shape: z.enum(['box', 'round']).default('box'),
});
export const BlurRegion: React.FC<ComponentProps<z.infer<typeof BlurRegionProps>>> = ({ props, elapsed }) => {
	const { height: H } = useVideoConfig();
	const k = grow(elapsed, 0.2);
	const r = props.shape === 'round' ? '50%' : 0.008 * H;
	if (props.mode === 'blackout') return <div style={{ width: '100%', height: '100%', background: '#000', borderRadius: r, opacity: k }} />;
	const blur = props.amount * (H / 1080) * k;
	return <div style={{ width: '100%', height: '100%', borderRadius: r, backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`, background: props.mode === 'frost' ? `rgba(255,255,255,${0.18 * k})` : undefined }} />;
};

export const ArrowProps = z.object({
	color: z.string().default('accent'),
	thickness: z.number().min(2).max(40).default(12).describe('px at 1080p'),
	bob: z.boolean().default(true).describe('bounce toward the target'),
});
/** Drawn left → right across its box; rotate the layer (or draw the arrow in the editor) to point it anywhere. */
export const Arrow: React.FC<ComponentProps<z.infer<typeof ArrowProps>>> = ({ props, layer, elapsed }) => {
	const { look } = useStudio();
	const { width: W, height: H } = useVideoConfig();
	const w = (layer.box.w / 100) * W;
	const h = (layer.box.h / 100) * H;
	const th = props.thickness * (H / 1080);
	const c = tone(look, props.color);
	const head = Math.min(w * 0.4, th * 4.2, w * 0.5);
	const d = grow(elapsed, 0.3);
	const bob = props.bob ? Math.sin(elapsed * 6) * w * 0.035 : 0;
	const y = h / 2;
	const shaft = `M ${th} ${y} L ${w - head * 0.7} ${y}`;
	const tip = `M ${w - head} ${y - head * 0.62} L ${w - th * 0.4} ${y} L ${w - head} ${y + head * 0.62}`;
	return (
		<svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', transform: `translateX(${bob}px)` }}>
			{[look.strokeColor, c].map((col, i) => (
				<g key={i} fill="none" stroke={col} strokeWidth={i === 0 ? th * 1.8 : th} strokeLinecap="round" strokeLinejoin="round" pathLength={1}>
					<path d={shaft} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - d} />
					<path d={tip} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01((d - 0.5) * 2)} />
				</g>
			))}
		</svg>
	);
};

export const ClickRippleProps = z.object({ color: z.string().default('accent'), rings: z.number().int().min(1).max(4).default(2), cursor: z.boolean().default(true) });
export const ClickRipple: React.FC<ComponentProps<z.infer<typeof ClickRippleProps>>> = ({ props, elapsed }) => {
	const { look } = useStudio();
	const c = tone(look, props.color);
	return (
		<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
			{Array.from({ length: props.rings }).map((_, i) => {
				const u = clamp01((elapsed - i * 0.18) / 0.7);
				return <circle key={i} cx={50} cy={50} r={8 + 40 * out(u)} fill="none" stroke={c} strokeWidth={5} opacity={u <= 0 ? 0 : 1 - u} />;
			})}
			<circle cx={50} cy={50} r={6} fill={c} stroke={look.strokeColor} strokeWidth={2} />
			{props.cursor ? <path d="M 50 50 L 50 82 L 58 75 L 64 88 L 70 85 L 64 72 L 75 72 Z" fill="#fff" stroke="#111" strokeWidth={2.5} strokeLinejoin="round" transform={`translate(0 ${Math.max(0, 8 - elapsed * 40)})`} /> : null}
		</svg>
	);
};

export const StepBadgeProps = z.object({ n: z.number().int().min(0).max(99).default(1), color: z.string().default('accent') });
export const StepBadge: React.FC<ComponentProps<z.infer<typeof StepBadgeProps>>> = ({ props, layer }) => {
	const { look } = useStudio();
	const { width: W } = useVideoConfig();
	const size = (Math.min(layer.box.w, layer.box.h * 1.78) / 100) * W;
	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
			<div style={{ width: size, height: size, borderRadius: '50%', background: tone(look, props.color), border: `${size * 0.07}px solid ${look.strokeColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: look.fontDisplay, fontSize: size * 0.56, color: look.strokeColor, lineHeight: 1, boxShadow: look.shadow }}>{props.n}</div>
		</div>
	);
};

export const LowerThirdProps = z.object({ title: z.string().default('Name'), subtitle: z.string().default(''), color: z.string().default('accent') });
export const LowerThird: React.FC<ComponentProps<z.infer<typeof LowerThirdProps>>> = ({ props, layer, elapsed }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	const k = grow(elapsed, 0.35);
	const bar = (layer.box.h / 100) * H;
	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', transform: `translateX(${(1 - k) * -40}%)`, opacity: k }}>
			<div style={{ width: bar * 0.12, alignSelf: 'stretch', background: tone(look, props.color), borderRadius: 4, marginRight: bar * 0.14 }} />
			<div style={{ display: 'flex', flexDirection: 'column', gap: bar * 0.05, textShadow: `0 0 ${bar * 0.05}px #000` }}>
				<span style={{ fontFamily: look.fontDisplay, fontSize: bar * 0.4, color: look.text, lineHeight: 1.05, WebkitTextStroke: `${bar * 0.04}px ${look.strokeColor}`, paintOrder: 'stroke' }}>{props.title}</span>
				{props.subtitle ? <span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: bar * 0.25, color: look.accent, WebkitTextStroke: `${bar * 0.03}px ${look.strokeColor}`, paintOrder: 'stroke' }}>{props.subtitle}</span> : null}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- moment effects (full frame, over the layer's length)
export const FlashProps = z.object({ color: z.string().default('white'), intensity: z.number().min(0.1).max(1).default(0.9) });
export const Flash: React.FC<ComponentProps<z.infer<typeof FlashProps>>> = ({ props, elapsed, length }) => {
	const { look } = useStudio();
	const u = clamp01(elapsed / Math.max(0.08, length));
	return <AbsoluteFill style={{ background: tone(look, props.color), opacity: props.intensity * Math.pow(1 - u, 1.6) }} />;
};

export const FadeBlackProps = z.object({ mode: z.enum(['dip', 'in', 'out']).default('dip').describe('dip = to black and back; out = to black; in = from black'), color: z.string().default('black') });
export const FadeBlack: React.FC<ComponentProps<z.infer<typeof FadeBlackProps>>> = ({ props, elapsed, length }) => {
	const { look } = useStudio();
	const u = clamp01(elapsed / Math.max(0.1, length));
	const o = props.mode === 'in' ? 1 - u : props.mode === 'out' ? u : 1 - Math.abs(u * 2 - 1);
	return <AbsoluteFill style={{ background: tone(look, props.color), opacity: o }} />;
};

export const RevealProps = z.object({
	style: z.enum(['iris', 'clock', 'slats', 'whip']).default('iris').describe('iris = circle closes then opens; clock = a sweep like a clock hand; slats = staggered bars; whip = fast blurred pan'),
	color: z.string().default('black'),
});
/** Four more transitions: cover the frame over the first half of the layer, uncover over the second (the cut happens under the cover). */
export const Reveal: React.FC<ComponentProps<z.infer<typeof RevealProps>>> = ({ props, elapsed, length }) => {
	const { look } = useStudio();
	const u = clamp01(elapsed / Math.max(0.15, length));
	const ease = Easing.inOut(Easing.cubic);
	const cover = ease(clamp01(u * 2));
	const uncover = ease(clamp01(u * 2 - 1));
	const col = tone(look, props.color);
	if (props.style === 'iris') {
		const r = u < 0.5 ? 78 * (1 - cover) : 78 * uncover; // radius of the hole, % of the diagonal
		return <AbsoluteFill style={{ background: col, WebkitMaskImage: `radial-gradient(circle at 50% 50%, transparent ${r}%, #000 ${r + 0.4}%)`, maskImage: `radial-gradient(circle at 50% 50%, transparent ${r}%, #000 ${r + 0.4}%)` }} />;
	}
	if (props.style === 'clock') {
		const tail = uncover * 360;
		const head = cover * 360;
		return <AbsoluteFill style={{ background: `conic-gradient(from 0deg at 50% 50%, transparent 0deg ${tail}deg, ${col} ${tail}deg ${head}deg, transparent ${head}deg 360deg)` }} />;
	}
	if (props.style === 'slats') {
		const n = 6;
		return (
			<AbsoluteFill>
				{Array.from({ length: n }, (_, i) => {
					const lag = (i / n) * 0.35;
					const a = ease(clamp01((u * 2 - lag) / (1 - 0.35)));
					const b = ease(clamp01(((u * 2 - 1) - lag) / (1 - 0.35)));
					return <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / n) * 100}%`, height: `${100 / n + 0.2}%`, background: col, clipPath: `inset(0 ${100 - a * 100}% 0 ${b * 100}%)` }} />;
				})}
			</AbsoluteFill>
		);
	}
	// whip: the picture smears sideways at the midpoint
	const blur = Math.sin(Math.PI * u) * 46;
	const streak = interpolate(u, [0, 1], [-60, 160]);
	return (
		<AbsoluteFill style={{ backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`, overflow: 'hidden' }}>
			<div style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', left: `${streak}%`, background: `linear-gradient(90deg, transparent, ${col === 'black' ? 'rgba(255,255,255,0.35)' : col}, transparent)`, opacity: Math.sin(Math.PI * u), transform: 'skewX(-18deg)' }} />
		</AbsoluteFill>
	);
};

export const WipeProps = z.object({ direction: z.enum(['right', 'left', 'up', 'down']).default('right'), color: z.string().default('accent') });
export const Wipe: React.FC<ComponentProps<z.infer<typeof WipeProps>>> = ({ props, elapsed, length }) => {
	const { look } = useStudio();
	const u = clamp01(elapsed / Math.max(0.15, length));
	const cover = Easing.inOut(Easing.cubic)(clamp01(u * 2));
	const reveal = Easing.inOut(Easing.cubic)(clamp01(u * 2 - 1));
	const inset = (a: number, b: number) => {
		const head = 100 - a * 100;
		const tail = b * 100;
		switch (props.direction) {
			case 'right': return `inset(0 ${head}% 0 ${tail}%)`;
			case 'left': return `inset(0 ${tail}% 0 ${head}%)`;
			case 'down': return `inset(${tail}% 0 ${head}% 0)`;
			default: return `inset(${head}% 0 ${tail}% 0)`;
		}
	};
	return <AbsoluteFill style={{ background: tone(look, props.color), clipPath: inset(cover, reveal) }} />;
};

export const GlitchProps = z.object({ intensity: z.number().min(0.1).max(1).default(0.7) });
export const Glitch: React.FC<ComponentProps<z.infer<typeof GlitchProps>>> = ({ props, layer, frame, elapsed, length }) => {
	const step = Math.floor(frame / 2);
	const env = Math.sin(Math.PI * clamp01(elapsed / Math.max(0.1, length)));
	const bars = useMemo(() => Array.from({ length: 9 }), []);
	return (
		<AbsoluteFill style={{ opacity: env, mixBlendMode: 'screen' }}>
			{bars.map((_, k) => {
				const r = (n: string) => random(`${layer.id}-${k}-${n}-${step}`);
				const hot = r('on') < 0.35 + 0.5 * props.intensity;
				return hot ? <div key={k} style={{ position: 'absolute', left: `${(r('dx') - 0.5) * 14 * props.intensity}%`, top: `${r('y') * 94}%`, width: '100%', height: `${1.2 + r('h') * 7 * props.intensity}%`, background: ['#ff2a55', '#00e5ff', '#ffffff'][Math.floor(r('c') * 3)], opacity: 0.35 + r('o') * 0.4 }} /> : null;
			})}
			<AbsoluteFill style={{ background: `rgba(255,0,60,${0.06 * props.intensity})`, transform: `translateX(${(random(`${layer.id}-sh-${step}`) - 0.5) * 3 * props.intensity}%)` }} />
		</AbsoluteFill>
	);
};

export const VignetteProps = z.object({ strength: z.number().min(0.1).max(1).default(0.55) });
export const Vignette: React.FC<ComponentProps<z.infer<typeof VignetteProps>>> = ({ props, elapsed }) => (
	<AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${props.strength * grow(elapsed, 0.4)}) 100%)` }} />
);

export const LetterboxProps = z.object({ size: z.number().min(4).max(20).default(11).describe('bar height, % of the frame') });
export const Letterbox: React.FC<ComponentProps<z.infer<typeof LetterboxProps>>> = ({ props, elapsed }) => {
	const h = props.size * grow(elapsed, 0.4);
	return (
		<AbsoluteFill>
			<div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${h}%`, background: '#000' }} />
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${h}%`, background: '#000' }} />
		</AbsoluteFill>
	);
};

// ---------------------------------------------------------------- captions
const Word = z.object({ text: z.string(), start: z.number(), end: z.number() });
export const CaptionsProps = z.object({
	words: z.array(Word).describe('the transcript, in global seconds'),
	style: z.enum(['pop', 'line', 'karaoke']).default('pop').describe('pop: a few big words, current one highlighted; line: a subtitle line; karaoke: the line fills as it is spoken'),
	position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
	color: z.string().default('accent').describe('highlight colour'),
	size: z.number().min(0.03).max(0.14).default(0.07).describe('text height as a fraction of the frame'),
	uppercase: z.boolean().default(true),
	maxWords: z.number().int().min(1).max(10).default(4),
});
type CW = z.infer<typeof Word>;
const chunks = (words: CW[], maxWords: number): CW[][] => {
	const out: CW[][] = [];
	let cur: CW[] = [];
	words.forEach((w, i) => {
		cur.push(w);
		const next = words[i + 1];
		if (cur.length >= maxWords || /[.!?]$/.test(w.text) || (next && next.start - w.end > 0.6) || (/[,;:]$/.test(w.text) && cur.length >= 2)) {
			out.push(cur);
			cur = [];
		}
	});
	if (cur.length) out.push(cur);
	return out;
};
export const Captions: React.FC<ComponentProps<z.infer<typeof CaptionsProps>>> = ({ props, time }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	const groups = useMemo(() => chunks(props.words, props.style === 'pop' ? props.maxWords : Math.max(props.maxWords, 6)), [props.words, props.maxWords, props.style]);
	const group = groups.find((g) => time >= g[0].start - 0.05 && time < g[g.length - 1].end + 0.25);
	if (!group) return null;
	const px = props.size * H;
	const hl = tone(look, props.color);
	const family = props.style === 'pop' ? look.fontDisplay : look.fontBody;
	const cur = group.findIndex((w, i) => time >= w.start && (i === group.length - 1 || time < group[i + 1].start));
	const justify = props.position === 'bottom' ? 'flex-end' : props.position === 'top' ? 'flex-start' : 'center';
	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: justify, justifyContent: 'center', padding: `${H * 0.02}px 0` }}>
			<div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `${px * 0.1}px ${px * 0.28}px`, maxWidth: '100%' }}>
				{group.map((w, i) => {
					const active = i === cur;
					const spoken = props.style === 'karaoke' ? i <= cur : active;
					const pop = props.style === 'pop' && active ? 1 + 0.12 * Math.max(0, 1 - (time - w.start) * 9) : 1;
					const t = props.uppercase ? w.text.toUpperCase() : w.text;
					return (
						<span key={i} style={{ fontFamily: family, fontWeight: 900, fontSize: px * (props.style === 'pop' && active ? 1.12 : 1), color: spoken ? hl : look.text, WebkitTextStroke: `${px * look.textStroke * 0.9}px ${look.strokeColor}`, paintOrder: 'stroke', transform: `scale(${pop})`, lineHeight: 1.1, textShadow: `0 ${px * 0.06}px ${px * 0.18}px rgba(0,0,0,0.5)` }}>{t}</span>
					);
				})}
			</div>
		</div>
	);
};

void interpolate;
