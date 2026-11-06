import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../../context';
import { toFrame } from '../../edd/timing';
import type { ComponentProps } from '../types';
import { MONO, Panel } from './Panel';

// ------------------------------------------------------------------ tiny deterministic highlighter
type Tok = { t: string; k: 'kw' | 'str' | 'num' | 'com' | 'fn' | 'txt' };
const KW = new Set(('const let var function return if else for while import from export class new async await def print in not and or ' +
	'int float char void include using namespace std struct public private true false null None True False sudo apt snap cd ls mkdir chmod nano echo').split(' '));

export const tokenize = (line: string): Tok[] => {
	const out: Tok[] = [];
	const re = /(\/\/.*|#(?!include).*|"[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_]*(?=\()|[A-Za-z_][A-Za-z0-9_]*|\s+|.)/g;
	for (const m of line.matchAll(re)) {
		const s = m[0];
		const k: Tok['k'] = s.startsWith('//') || (s.startsWith('#') && !s.startsWith('#include')) ? 'com'
			: /^["']/.test(s) ? 'str' : /^\d/.test(s) ? 'num' : KW.has(s) ? 'kw' : /^[A-Za-z_]/.test(s) && line[(m.index ?? 0) + s.length] === '(' ? 'fn' : 'txt';
		out.push({ t: s, k });
	}
	return out;
};

const COLORS = { kw: '#FF7B72', str: '#A5D6FF', num: '#79C0FF', com: '#6E7681', fn: '#D2A8FF', txt: '#E6EDF3' };

/**
 * Largest monospace size that fits both the line count (height) and the longest line (width) inside
 * the panel. A JetBrains Mono glyph is ~0.6 em wide; the panel's padding and title take ~22 % of height.
 */
export const monoFontSize = (box: { w: number; h: number }, W: number, H: number, lines: number, cols: number, cap: number) => {
	const innerW = (box.w / 100) * W - 0.05 * H;
	const innerH = (box.h / 100) * H * 0.78;
	return Math.min(cap * H, innerH / Math.max(4, lines) / 1.45, innerW / Math.max(10, cols) / 0.6);
};

// ------------------------------------------------------------------ CodeBlock
export const CodeBlockProps = z.object({
	code: z.string().describe('the code; newlines separate lines'),
	language: z.string().default('text'),
	highlightLines: z.array(z.number().int().min(1)).default([]).describe('1-based lines to highlight'),
	highlightAt: z.number().min(0).default(0.8).describe('seconds after entrance to highlight'),
	reveal: z.enum(['all', 'lines', 'typewriter']).default('lines'),
	title: z.string().optional(),
	panel: z.boolean().default(true),
});

/** Code on a dark panel: lines appear one by one (or typed), then the important lines get highlighted. */
export const CodeBlock: React.FC<ComponentProps<z.infer<typeof CodeBlockProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps, width: W, height: H } = useVideoConfig();
	const lines = props.code.replace(/\t/g, '  ').split('\n');
	const f = frame - toFrame(layer.enter.at, fps) - layer.enter.durationFrames;
	const fontSize = monoFontSize(layer.box, W, H, lines.length, Math.max(...lines.map((l) => l.length)) + 3, 0.05);
	const totalChars = lines.reduce((n, l) => n + l.length + 1, 0);
	const typed = props.reveal === 'typewriter' ? Math.floor(interpolate(f, [0, Math.max(10, totalChars * 0.6)], [0, totalChars], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : Infinity;
	const hl = interpolate(f - toFrame(props.highlightAt, fps), [0, 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	let budget = typed;
	return (
		<Panel show={props.panel} title={props.title}>
			<div style={{ fontFamily: MONO, fontSize, lineHeight: 1.45, whiteSpace: 'pre' }}>
				{lines.map((line, i) => {
					const visibleLine = props.reveal === 'lines' ? f >= i * 3 : true;
					const shown = budget >= line.length ? line : line.slice(0, Math.max(0, budget));
					budget -= line.length + 1;
					const highlighted = props.highlightLines.includes(i + 1);
					return (
						<div key={i} style={{ display: 'flex', opacity: visibleLine ? 1 : 0, position: 'relative' }}>
							{highlighted ? <div style={{ position: 'absolute', inset: '0 -0.4em', background: look.accent, opacity: 0.18 * hl, borderLeft: `0.2em solid ${look.accent}` }} /> : null}
							<span style={{ color: '#6E7681', width: '2.4em', flexShrink: 0, position: 'relative' }}>{i + 1}</span>
							<span style={{ position: 'relative' }}>
								{tokenize(shown).map((t, k) => <span key={k} style={{ color: COLORS[t.k] }}>{t.t}</span>)}
							</span>
						</div>
					);
				})}
			</div>
		</Panel>
	);
};

// ------------------------------------------------------------------ Terminal
export const TerminalProps = z.object({
	prompt: z.string().default('$'),
	command: z.string(),
	output: z.array(z.string()).default([]),
	charsPerSecond: z.number().positive().default(28),
	title: z.string().default('Terminal'),
});

/** A terminal: the command types out, then output lines appear. */
export const Terminal: React.FC<ComponentProps<z.infer<typeof TerminalProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps, width: W, height: H } = useVideoConfig();
	const f = frame - toFrame(layer.enter.at, fps) - layer.enter.durationFrames;
	const typeFrames = (props.command.length / props.charsPerSecond) * fps;
	const chars = Math.floor(interpolate(f, [0, typeFrames], [0, props.command.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
	const outStart = typeFrames + 0.3 * fps;
	const cols = Math.max(props.prompt.length + props.command.length + 2, ...props.output.map((l) => l.length));
	const fontSize = monoFontSize(layer.box, W, H, props.output.length + 3, cols, 0.045);
	const cursorOn = Math.floor(f / (fps / 2)) % 2 === 0;
	return (
		<Panel show title={props.title}>
			<div style={{ fontFamily: MONO, fontSize, lineHeight: 1.45, color: '#E6EDF3', whiteSpace: 'pre-wrap' }}>
				<div>
					<span style={{ color: look.accent }}>{props.prompt} </span>
					{props.command.slice(0, chars)}
					{chars < props.command.length || f < outStart ? <span style={{ opacity: cursorOn ? 1 : 0 }}>▍</span> : null}
				</div>
				{props.output.map((l, i) => (f >= outStart + i * 2 ? <div key={i} style={{ color: '#9DA7B3' }}>{l}</div> : null))}
			</div>
		</Panel>
	);
};
