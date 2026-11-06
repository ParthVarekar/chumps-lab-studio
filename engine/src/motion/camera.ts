import { Easing, interpolate } from 'remotion';
import type { CameraMove, Rect } from '../edd/schema';
import { toFrame } from '../edd/timing';

export interface CameraState {
	/** CSS transform for the stage (transform-origin 0 0). */
	transform: string;
	/** Perspective tilt for a wrapper around the stage (transform-origin: centre). */
	tilt: string;
	/** px of motion blur to apply while the camera moves fast. */
	blur: number;
	/** Current view rectangle in stage %, for debugging and QA geometry. */
	view: Rect;
	/** Current zoom factor (1 = no zoom). Stage layers can divide by it to keep a fixed screen size. */
	scale: number;
}

const FULL: Rect = { x: 0, y: 0, w: 100, h: 100 };
const snap = Easing.bezier(0.2, 0, 0, 1);

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
	w: a.w + (b.w - a.w) * t,
	h: a.h + (b.h - a.h) * t,
});

/** View rect at a frame: idle → zoom in (inFrames) → hold → zoom out (outFrames, unless 0). */
const viewAt = (moves: CameraMove[], frame: number, fps: number): { view: Rect; tilt: number } => {
	let view = FULL;
	let tilt = 0;
	const sorted = [...moves].sort((a, b) => a.at - b.at);
	for (let i = 0; i < sorted.length; i++) {
		const m = sorted[i];
		const t0 = toFrame(m.at, fps);
		if (frame < t0) break;
		const tIn = t0 + m.inFrames;
		const tHoldEnd = tIn + toFrame(m.hold, fps);
		const from = view;
		if (frame < tIn) {
			const p = interpolate(frame, [t0, tIn], [0, 1], { easing: snap });
			return { view: lerpRect(from, m.to, p), tilt: m.tiltDeg * p };
		}
		if (frame < tHoldEnd || m.outFrames === 0) {
			view = m.to;
			tilt = m.tiltDeg;
			continue;
		}
		const tOut = tHoldEnd + m.outFrames;
		if (frame < tOut) {
			const p = interpolate(frame, [tHoldEnd, tOut], [0, 1], { easing: Easing.inOut(Easing.cubic) });
			return { view: lerpRect(m.to, FULL, p), tilt: m.tiltDeg * (1 - p) };
		}
		view = FULL;
		tilt = 0;
	}
	return { view, tilt };
};

/**
 * Turn the view rect into a stage transform. The view keeps the frame's aspect ratio and is
 * clamped inside the stage, so a zoom never reveals empty edges.
 */
export const cameraAt = (moves: CameraMove[], frame: number, fps: number, W: number, H: number): CameraState => {
	const { view, tilt } = viewAt(moves, frame, fps);
	const prev = viewAt(moves, frame - 1, fps).view;

	// Scale so the requested rect fits the frame, never below 1.
	const s = Math.max(1, Math.min(100 / view.w, 100 / view.h));
	const halfW = W / (2 * s);
	const halfH = H / (2 * s);
	let cx = ((view.x + view.w / 2) / 100) * W;
	let cy = ((view.y + view.h / 2) / 100) * H;
	cx = Math.min(Math.max(cx, halfW), W - halfW);
	cy = Math.min(Math.max(cy, halfH), H - halfH);
	const tx = W / 2 - s * cx;
	const ty = H / 2 - s * cy;

	// Blur proportional to how far the view centre moved this frame (in output pixels).
	const pcx = ((prev.x + prev.w / 2) / 100) * W;
	const pcy = ((prev.y + prev.h / 2) / 100) * H;
	const speed = Math.hypot(cx - pcx, cy - pcy) * s + Math.abs(view.w - prev.w) * 0.01 * W;
	const blur = Math.min(6, speed * 0.02);

	return {
		transform: `translate(${tx}px, ${ty}px) scale(${s})`,
		tilt: tilt !== 0 ? `perspective(${W * 1.4}px) rotateY(${tilt}deg)` : 'none',
		blur,
		view,
		scale: s,
	};
};
