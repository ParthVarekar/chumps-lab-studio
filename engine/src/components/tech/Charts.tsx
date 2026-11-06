import React from 'react';
import { Easing, interpolate, spring, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../../context';
import { toFrame } from '../../edd/timing';
import type { ComponentProps } from '../types';
import { Panel } from './Panel';

const fmtNum = (v: number, decimals: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// ------------------------------------------------------------------ BarChart
export const BarChartProps = z.object({
	bars: z.array(z.object({ label: z.string(), value: z.number() })).min(1).max(12),
	unit: z.string().default(''),
	decimals: z.number().int().min(0).max(3).default(0),
	highlight: z.string().optional().describe('label of the bar to emphasise'),
	title: z.string().optional(),
	orientation: z.enum(['vertical', 'horizontal']).default('horizontal'),
});

/** Bars grow one after another, values count up, the highlighted bar takes the accent colour. */
export const BarChart: React.FC<ComponentProps<z.infer<typeof BarChartProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps, height: H } = useVideoConfig();
	const f = frame - toFrame(layer.enter.at, fps) - layer.enter.durationFrames;
	const max = Math.max(...props.bars.map((b) => b.value), 1e-9);
	const fontSize = 0.026 * H;
	const horizontal = props.orientation === 'horizontal';
	return (
		<Panel show title={props.title}>
			<div style={{ display: 'flex', flexDirection: horizontal ? 'column' : 'row', justifyContent: 'space-around', alignItems: horizontal ? 'stretch' : 'flex-end', width: '100%', height: '100%', gap: 0.01 * H }}>
				{props.bars.map((b, i) => {
					const p = interpolate(f - i * 4, [0, 18], [0, 1], { easing: Easing.bezier(0.2, 0, 0, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
					const frac = (b.value / max) * p;
					const hot = props.highlight === b.label;
					const color = hot ? look.accent : 'rgba(231,230,227,0.55)';
					const value = `${fmtNum(b.value * p, props.decimals)}${props.unit}`;
					return horizontal ? (
						<div key={i} style={{ display: 'grid', gridTemplateColumns: '28% 1fr', alignItems: 'center', gap: '2%', flex: 1 }}>
							<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize, color: look.text, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden' }}>{b.label}</span>
							<div style={{ height: '62%', display: 'flex', alignItems: 'center', gap: '1.5%' }}>
								<div style={{ width: `${frac * 78}%`, height: '100%', background: color, borderRadius: 0.004 * H }} />
								<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: fontSize * 0.95, color: hot ? look.accent : look.text, whiteSpace: 'nowrap' }}>{p > 0 ? value : ''}</span>
							</div>
						</div>
					) : (
						<div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', flex: 1 }}>
							<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: fontSize * 0.95, color: hot ? look.accent : look.text }}>{p > 0 ? value : ''}</span>
							<div style={{ width: '58%', height: `${frac * 72}%`, background: color, borderRadius: 0.004 * H, marginTop: 0.006 * H }} />
							<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: fontSize * 0.85, color: look.text, marginTop: 0.008 * H, whiteSpace: 'nowrap' }}>{b.label}</span>
						</div>
					);
				})}
			</div>
		</Panel>
	);
};

// ------------------------------------------------------------------ Gauge
export const GaugeProps = z.object({
	value: z.number(),
	max: z.number().positive(),
	min: z.number().default(0),
	label: z.string().default(''),
	unit: z.string().default(''),
	redlineFrom: z.number().optional().describe('values above this are drawn in the warning colour'),
	decimals: z.number().int().min(0).max(2).default(0),
});

/** Speedometer: the needle swings up with a little overshoot, the readout counts along with it. */
export const Gauge: React.FC<ComponentProps<z.infer<typeof GaugeProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps } = useVideoConfig();
	const f = frame - toFrame(layer.enter.at, fps) - Math.floor(layer.enter.durationFrames / 2);
	const p = spring({ frame: f, fps, config: { damping: 9, stiffness: 70, mass: 0.9 } });
	const frac = Math.max(0, Math.min(1.04, ((props.value - props.min) / (props.max - props.min)) * p));
	const START = -210, SWEEP = 240; // degrees, 0 = 3 o'clock
	const ang = (START + SWEEP * frac) * (Math.PI / 180);
	const cx = 50, cy = 54, r = 38;
	const arc = (a0: number, a1: number) => {
		const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
		const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
		return `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}`;
	};
	const toRad = (v: number) => (START + SWEEP * ((v - props.min) / (props.max - props.min))) * (Math.PI / 180);
	const a0 = START * (Math.PI / 180);
	const aEnd = (START + SWEEP) * (Math.PI / 180);
	const red = props.redlineFrom !== undefined ? toRad(props.redlineFrom) : aEnd;
	const ticks = Array.from({ length: 11 }, (_, i) => a0 + ((aEnd - a0) * i) / 10);
	const shown = props.min + (props.value - props.min) * Math.min(1, p);
	return (
		<Panel show>
			<svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
				<path d={arc(a0, red)} stroke="rgba(231,230,227,0.25)" strokeWidth={5} fill="none" strokeLinecap="round" />
				{red < aEnd ? <path d={arc(red, aEnd)} stroke={look.accent2} strokeWidth={5} fill="none" strokeLinecap="round" /> : null}
				<path d={arc(a0, Math.max(a0 + 0.001, ang))} stroke={look.accent} strokeWidth={5} fill="none" strokeLinecap="round" />
				{ticks.map((a, i) => (
					<line key={i} x1={cx + (r - 8) * Math.cos(a)} y1={cy + (r - 8) * Math.sin(a)} x2={cx + (r - 5) * Math.cos(a)} y2={cy + (r - 5) * Math.sin(a)} stroke="rgba(231,230,227,0.5)" strokeWidth={0.8} />
				))}
				<line x1={cx} y1={cy} x2={cx + (r - 6) * Math.cos(ang)} y2={cy + (r - 6) * Math.sin(ang)} stroke={look.text} strokeWidth={2} strokeLinecap="round" />
				<circle cx={cx} cy={cy} r={3} fill={look.text} />
				<text x={cx} y={cy + 20} textAnchor="middle" fill={look.text} style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: 11 }}>
					{fmtNum(shown, props.decimals)}{props.unit}
				</text>
				<text x={cx} y={cy + 29} textAnchor="middle" fill="rgba(231,230,227,0.7)" style={{ fontFamily: look.fontBody, fontWeight: 600, fontSize: 5.5 }}>
					{props.label}
				</text>
			</svg>
		</Panel>
	);
};
