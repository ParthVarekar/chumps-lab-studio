import { Easing, interpolate, spring } from 'remotion';
import type { Layer } from '../edd/schema';
import { toFrame } from '../edd/timing';

export interface MotionState {
	visible: boolean;
	opacity: number;
	/** Extra translation in px and scale/rotation applied on top of the layer's box. */
	tx: number;
	ty: number;
	scale: number;
	rotate: number;
	/** Directional motion blur in px (x, y), for an SVG feGaussianBlur. */
	blurX: number;
	blurY: number;
	/** 0→1 progress of the entrance (components like typewriter text use it). */
	progress: number;
}

const HIDDEN: MotionState = { visible: false, opacity: 0, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 0 };
const STILL: MotionState = { visible: true, opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 1 };

// A strong ease-out: fast start, soft landing. Your quick 0.2 s moves feel like this.
const snap = Easing.bezier(0.2, 0, 0, 1);

/** Distance (px) that moves a box fully off-frame in the given direction. */
const offscreen = (layer: Layer, dir: string, W: number, H: number) => {
	const { x, y, w, h } = layer.box;
	switch (dir) {
		case 'left': return { dx: -((x + w) / 100) * W - 20, dy: 0 };
		case 'right': return { dx: ((100 - x) / 100) * W + 20, dy: 0 };
		case 'up': return { dx: 0, dy: -((y + h) / 100) * H - 20 };
		case 'down': return { dx: 0, dy: ((100 - y) / 100) * H + 20 };
		default: return { dx: 0, dy: 0 };
	}
};

/**
 * Motion of one layer at `frame` (frame counted from the start of its beat).
 * Everything is a pure function of the frame number, so renders are deterministic.
 */
export const layerMotion = (layer: Layer, frame: number, fps: number, W: number, H: number): MotionState => {
	const start = toFrame(layer.enter.at, fps);
	const f = frame - start;
	if (f < 0) return HIDDEN;

	const dur = Math.max(1, layer.enter.durationFrames);
	const dir = layer.enter.direction;
	let s: MotionState = { ...STILL };

	switch (layer.enter.preset) {
		case 'cut':
			break;
		case 'fade': {
			const p = interpolate(f, [0, dur], [0, 1], { extrapolateRight: 'clamp' });
			s = { ...s, opacity: p, progress: p };
			break;
		}
		case 'pop': {
			// Spring overshoots to ~1.08 and settles; the opacity ramp hides the first tiny frames.
			const p = spring({ frame: f, fps, config: { damping: 11, stiffness: 240, mass: 0.55 }, durationInFrames: dur + 6 });
			const off = offscreen(layer, dir, W, H);
			const fromCenter = dir === 'center';
			s = {
				...s,
				scale: fromCenter ? p : 0.6 + 0.4 * p,
				tx: fromCenter ? 0 : off.dx * 0.15 * (1 - p),
				ty: fromCenter ? 0 : off.dy * 0.15 * (1 - p),
				opacity: interpolate(f, [0, 2], [0, 1], { extrapolateRight: 'clamp' }),
				progress: Math.min(1, p),
			};
			break;
		}
		case 'slide':
		case 'slide-blur': {
			const off = offscreen(layer, dir === 'center' ? 'down' : dir, W, H);
			const p = interpolate(f, [0, dur], [0, 1], { easing: snap, extrapolateRight: 'clamp' });
			const pPrev = interpolate(f - 1, [0, dur], [0, 1], { easing: snap, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
			const v = p - pPrev; // fraction of the trip covered this frame
			// Blur ~ distance travelled this frame, capped so the word stays recognisable mid-move.
			const blur = layer.enter.preset === 'slide-blur' ? 0.12 : 0;
			const cap = 0.02 * W;
			s = {
				...s,
				tx: off.dx * (1 - p),
				ty: off.dy * (1 - p),
				blurX: Math.min(cap, Math.abs(off.dx * v) * blur),
				blurY: Math.min(cap, Math.abs(off.dy * v) * blur),
				progress: p,
			};
			break;
		}
		case 'drop': {
			const p = spring({ frame: f, fps, config: { damping: 9, stiffness: 160, mass: 0.7 } });
			const off = offscreen(layer, 'up', W, H);
			s = { ...s, ty: off.dy * (1 - p), progress: Math.min(1, p) };
			break;
		}
		case 'scale-in': {
			const p = interpolate(f, [0, dur], [0, 1], { easing: snap, extrapolateRight: 'clamp' });
			s = { ...s, scale: 0.92 + 0.08 * p, ty: (1 - p) * 0.02 * H, opacity: p, progress: p };
			break;
		}
		case 'typewriter': {
			const p = interpolate(f, [0, dur], [0, 1], { extrapolateRight: 'clamp' });
			s = { ...s, progress: p };
			break;
		}
	}

	// Exit
	if (layer.exit) {
		const e0 = toFrame(layer.exit.at, fps);
		const fe = frame - e0;
		if (fe >= 0) {
			const edur = Math.max(1, layer.exit.durationFrames);
			if (layer.exit.preset === 'cut' || fe >= edur) return HIDDEN;
			const q = interpolate(fe, [0, edur], [0, 1], { easing: Easing.in(Easing.quad), extrapolateRight: 'clamp' });
			if (layer.exit.preset === 'fade') s.opacity *= 1 - q;
			if (layer.exit.preset === 'scale-out') { s.scale *= 1 - 0.15 * q; s.opacity *= 1 - q; }
			if (layer.exit.preset === 'slide') { const off = offscreen(layer, dir === 'center' ? 'down' : dir, W, H); s.tx += off.dx * q; s.ty += off.dy * q; }
		}
	}
	return s;
};
