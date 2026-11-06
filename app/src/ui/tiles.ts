/**
 * The library's tiles and how each one is placed. Every placement shares one idea: do it where you point.
 *   region  draw a box on the preview (or drop the tile: it lands as a default-sized box under the pointer)
 *   vector  drag from where it starts to where it points (arrows)
 *   point   click or drop at a spot
 *   moment  one click; centred on the playhead (transitions)
 *   range   captions: whole video, from the playhead, or a stretch
 */
import type { Op } from '../../shared/ops';
import type { Region } from '../store';

export type Placement = 'region' | 'vector' | 'point' | 'moment';
export interface Tile {
	id: string;
	label: string;
	hint: string;
	placement: Placement;
	/** A layer to add. Omit for tiles that map to other commands (zoom punch, shake). */
	component?: string;
	props?: Record<string, unknown>;
	len?: number; // seconds
	size?: { w: number; h: number }; // default box, % of frame (point / drop)
	space?: 'screen' | 'stage';
	special?: 'zoom-punch' | 'shake';
	why?: string;
}

export const ASPECT = 16 / 9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Geometry {
	time: number;
	region?: Region;
	point?: { x: number; y: number };
	vector?: { x0: number; y0: number; x1: number; y1: number };
}

/** The command for placing a tile with the given geometry. */
export function placeOp(t: Tile, g: Geometry): Op {
	const len = t.len ?? 3;
	if (t.special === 'zoom-punch') return { op: 'add_zoom', at: Math.max(0, g.time - 0.12), until: g.time + 0.45, to: { x: 11, y: 11, w: 78, h: 78 }, why: 'zoom punch (you added it)' };
	if (t.special === 'shake') return { op: 'add_mood', kind: 'shake', at: Math.max(0, g.time - 0.1), duration: 0.5, why: 'shake (you added it)' };
	const base = { op: 'add_layer' as const, component: t.component!, props: t.props ?? {}, space: t.space, why: `${t.label} (you added it)` };

	if (t.placement === 'moment') return { ...base, at: Math.max(0, g.time - len / 2), until: g.time + len / 2 };

	if (t.placement === 'vector') {
		const v = g.vector ?? { x0: (g.point?.x ?? 40) - 8, y0: g.point?.y ?? 50, x1: (g.point?.x ?? 40) + 8, y1: g.point?.y ?? 50 };
		const dx = (v.x1 - v.x0) * ASPECT; // both axes in "% of frame height" units so the angle is true
		const dy = v.y1 - v.y0;
		const lenH = Math.max(6, Math.hypot(dx, dy));
		const w = lenH / ASPECT;
		const cx = (v.x0 + v.x1) / 2;
		const cy = (v.y0 + v.y1) / 2;
		const h = 9;
		return { ...base, at: g.time, until: g.time + len, box: { x: +(cx - w / 2).toFixed(2), y: +(cy - h / 2).toFixed(2), w: +w.toFixed(2), h, rotation: +((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1) } };
	}

	let box: { x: number; y: number; w: number; h: number };
	if (t.placement === 'region' && g.region) box = g.region;
	else {
		const size = t.size ?? { w: 20, h: 12 };
		const p = g.point ?? { x: 50, y: 50 };
		box = { x: clamp(p.x - size.w / 2, 0, 100 - size.w), y: clamp(p.y - size.h / 2, 0, 100 - size.h), ...size };
	}
	return { ...base, at: g.time, until: g.time + len, box: { x: +box.x.toFixed(2), y: +box.y.toFixed(2), w: +box.w.toFixed(2), h: +box.h.toFixed(2) } };
}

// ------------------------------------------------------------------ the tiles
export const ADD_TILES: Tile[] = [
	{ id: 'title', label: 'Title', hint: 'Big section title', placement: 'point', component: 'Title', props: { text: 'New title' }, len: 1.8, size: { w: 84, h: 22 } },
	{ id: 'big-word', label: 'Big word', hint: 'One word as big type', placement: 'point', component: 'KineticWord', props: { text: 'WORD' }, len: 1.2, size: { w: 76, h: 24 } },
	{ id: 'header', label: 'Step header', hint: 'Small yellow header', placement: 'point', component: 'Header', props: { text: 'Step' }, len: 6, size: { w: 40, h: 6 } },
	{ id: 'lower-third', label: 'Lower third', hint: 'Name and role bar', placement: 'point', component: 'LowerThird', props: { title: 'Name', subtitle: 'Role' }, len: 4, size: { w: 42, h: 14 } },
	{ id: 'step-badge', label: 'Step badge', hint: 'Numbered circle', placement: 'point', component: 'StepBadge', props: { n: 1 }, len: 3, size: { w: 7, h: 12.4 } },
	{ id: 'chip', label: 'Colour chip', hint: 'Swatch + name', placement: 'point', component: 'ColorChip', props: { color: '#0A84FF', label: 'blue' }, len: 1.8, size: { w: 9, h: 16 } },
	{ id: 'code', label: 'Code', hint: 'Highlighted block', placement: 'region', component: 'CodeBlock', props: { code: 'int main() {\n  return 0;\n}', reveal: 'lines', language: 'text' }, len: 3.5, size: { w: 60, h: 50 } },
	{ id: 'terminal', label: 'Terminal', hint: 'Typed command', placement: 'region', component: 'Terminal', props: { prompt: '$', command: 'echo hello', output: [], title: 'Terminal' }, len: 3, size: { w: 70, h: 24 } },
];

export const EFFECT_TILES: Tile[] = [
	{ id: 'hl-box', label: 'Highlight box', hint: 'Outline draws around it', placement: 'region', component: 'Highlight', props: { shape: 'box' }, len: 3, space: 'stage', size: { w: 24, h: 12 } },
	{ id: 'hl-ellipse', label: 'Circle it', hint: 'Ellipse around it', placement: 'region', component: 'Highlight', props: { shape: 'ellipse', fill: 0.12 }, len: 3, space: 'stage', size: { w: 24, h: 14 } },
	{ id: 'hl-underline', label: 'Underline', hint: 'Hand-drawn underline', placement: 'region', component: 'Highlight', props: { shape: 'underline' }, len: 3, space: 'stage', size: { w: 24, h: 6 } },
	{ id: 'spotlight', label: 'Spotlight', hint: 'Dims everything else', placement: 'region', component: 'Spotlight', props: {}, len: 3, space: 'stage', size: { w: 30, h: 18 } },
	{ id: 'blur', label: 'Blur', hint: 'Hide text or faces', placement: 'region', component: 'BlurRegion', props: { mode: 'blur' }, len: 3, space: 'stage', size: { w: 24, h: 12 } },
	{ id: 'blackout', label: 'Blackout', hint: 'Solid black box', placement: 'region', component: 'BlurRegion', props: { mode: 'blackout' }, len: 3, space: 'stage', size: { w: 24, h: 12 } },
	{ id: 'arrow', label: 'Arrow', hint: 'Drag from tail to tip', placement: 'vector', component: 'Arrow', props: {}, len: 2.5, space: 'stage' },
	{ id: 'ripple', label: 'Click here', hint: 'Cursor click ripple', placement: 'point', component: 'ClickRipple', props: {}, len: 1.6, space: 'stage', size: { w: 8, h: 14.2 } },
];

export const TRANSITION_TILES: Tile[] = [
	{ id: 'flash', label: 'Flash', hint: 'White flash on the cut', placement: 'moment', component: 'Flash', props: {}, len: 0.3 },
	{ id: 'dip', label: 'Dip to black', hint: 'Fade out and back', placement: 'moment', component: 'FadeBlack', props: { mode: 'dip' }, len: 0.9 },
	{ id: 'wipe', label: 'Colour wipe', hint: 'Bar sweeps across', placement: 'moment', component: 'Wipe', props: { direction: 'right' }, len: 0.7 },
	{ id: 'glitch', label: 'Glitch', hint: 'Digital glitch bars', placement: 'moment', component: 'Glitch', props: {}, len: 0.5 },
	{ id: 'punch', label: 'Zoom punch', hint: 'Quick punch-in on the beat', placement: 'moment', special: 'zoom-punch' },
	{ id: 'shake', label: 'Shake', hint: 'Camera shake', placement: 'moment', special: 'shake' },
	{ id: 'vignette', label: 'Vignette', hint: 'Darken the edges', placement: 'moment', component: 'Vignette', props: {}, len: 3 },
	{ id: 'letterbox', label: 'Letterbox', hint: 'Cinematic bars', placement: 'moment', component: 'Letterbox', props: {}, len: 4 },
];

export const CAPTION_STYLES: { id: 'pop' | 'line' | 'karaoke'; label: string; hint: string; props: Record<string, unknown> }[] = [
	{ id: 'pop', label: 'Pop words', hint: 'A few big words, the current one lights up', props: { style: 'pop', maxWords: 4, size: 0.075, uppercase: true } },
	{ id: 'line', label: 'Subtitle line', hint: 'A clean line at the bottom', props: { style: 'line', maxWords: 7, size: 0.048, uppercase: false } },
	{ id: 'karaoke', label: 'Karaoke fill', hint: 'The line fills as it is said', props: { style: 'karaoke', maxWords: 6, size: 0.055, uppercase: false } },
];

export const elementTile = (name: string, spec: unknown, params: Record<string, unknown>): Tile => ({
	id: `el-${name}`, label: name, hint: 'Animated element', placement: 'region', component: 'Generated', props: { spec, params }, len: 3.5, space: 'stage', size: { w: 20, h: 35.5 },
});
