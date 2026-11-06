import React from 'react';
import { interpolate, random, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../../context';
import { toFrame } from '../../edd/timing';
import type { ComponentProps } from '../types';
import { Panel } from './Panel';

export const NeuralNetProps = z.object({
	layers: z.array(z.number().int().min(1).max(12)).min(2).max(7).default([4, 6, 6, 3]).describe('nodes per layer'),
	labels: z.array(z.string()).default([]).describe('optional label under each layer, e.g. ["input", "hidden", "output"]'),
	pulses: z.number().int().min(0).max(6).default(2).describe('activation waves travelling input → output'),
	seed: z.string().default('nn'),
	panel: z.boolean().default(true),
});

/**
 * A neural network that builds layer by layer (nodes pop, edges draw), then activation pulses
 * travel from input to output, lighting nodes as they pass. Deterministic: weights come from the seed.
 */
export const NeuralNet: React.FC<ComponentProps<z.infer<typeof NeuralNetProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps } = useVideoConfig();
	const f = frame - toFrame(layer.enter.at, fps) - layer.enter.durationFrames;
	const L = props.layers.length;
	const W = 160, Hh = 90; // viewBox units (16:9)
	const xs = props.layers.map((_, i) => 14 + (i * (W - 28)) / (L - 1));
	const pos = props.layers.map((n, i) =>
		Array.from({ length: n }, (_, j) => ({ x: xs[i], y: Hh / 2 + (j - (n - 1) / 2) * Math.min(12, 70 / Math.max(1, n - 1 || 1)) })),
	);
	const build = 6; // frames per layer while building
	const builtAt = (i: number) => i * build;
	const pulseLen = 22; // frames for a pulse to cross one gap
	const pulseStart = L * build + 6;
	const wave = (t: number) => (t - pulseStart) / pulseLen; // position in layers (0 = input layer)

	const edges: React.ReactNode[] = [];
	for (let i = 0; i < L - 1; i++) {
		const draw = interpolate(f - builtAt(i + 1), [0, build], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
		pos[i].forEach((a, j) =>
			pos[i + 1].forEach((b, k) => {
				const w = random(`${props.seed}-${i}-${j}-${k}`);
				let glow = 0;
				for (let p = 0; p < props.pulses; p++) {
					const x = wave(f - p * pulseLen * (L - 0.5)) - i; // 0..1 while the wave crosses this gap
					if (x > 0 && x < 1) glow = Math.max(glow, Math.sin(Math.PI * x) * w);
				}
				const len = Math.hypot(b.x - a.x, b.y - a.y);
				edges.push(
					<line key={`${i}-${j}-${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
						stroke={glow > 0.25 ? look.accent : 'rgba(231,230,227,0.22)'} strokeOpacity={glow > 0.25 ? 0.4 + glow * 0.6 : 1}
						strokeWidth={0.35 + w * 0.5 + glow * 0.6} strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />,
				);
			}),
		);
	}
	const nodes = pos.flatMap((col, i) =>
		col.map((n, j) => {
			const s = interpolate(f - builtAt(i) - j, [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
			let lit = 0;
			for (let p = 0; p < props.pulses; p++) {
				const x = wave(f - p * pulseLen * (L - 0.5)) - i;
				if (x > -0.25 && x < 0.35) lit = Math.max(lit, 1 - Math.abs(x - 0.05) / 0.3);
			}
			return (
				<g key={`${i}-${j}`}>
					{lit > 0 ? <circle cx={n.x} cy={n.y} r={4.6 + lit * 2} fill={look.accent} opacity={0.25 * lit} /> : null}
					<circle cx={n.x} cy={n.y} r={3.2 * s} fill={lit > 0.3 ? look.accent : '#E7E6E3'} stroke="rgba(0,0,0,0.5)" strokeWidth={0.4} />
				</g>
			);
		}),
	);
	return (
		<Panel show={props.panel}>
			<svg viewBox={`0 0 ${W} ${Hh + (props.labels.length ? 10 : 0)}`} style={{ width: '100%', height: '100%' }}>
				{edges}
				{nodes}
				{props.labels.map((t, i) =>
					i < L ? (
						<text key={i} x={xs[i]} y={Hh + 6} textAnchor="middle" fill="rgba(231,230,227,0.75)" opacity={interpolate(f - builtAt(i), [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
							style={{ fontFamily: look.fontBody, fontWeight: 600, fontSize: 4.2 }}>{t}</text>
					) : null,
				)}
			</svg>
		</Panel>
	);
};
