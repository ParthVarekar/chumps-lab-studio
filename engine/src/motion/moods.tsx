import React from 'react';
import { AbsoluteFill, interpolate, random } from 'remotion';
import type { Mood } from '../edd/schema';
import { toFrame } from '../edd/timing';

export interface MoodEffects {
	/** Applied to the whole beat (footage + overlays). */
	filter: string;
	transform: string;
	overlays: React.ReactNode[];
}

/** Envelope: quick attack, hold, release — so moods never pop on/off abruptly. */
const envelope = (f: number, dur: number) => {
	const attack = Math.min(4, dur / 3);
	const release = Math.min(8, dur / 3);
	return interpolate(f, [0, attack, dur - release, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
};

/**
 * Composable emotion effects (blueprint §5.7). Each mood contributes a filter, a transform
 * and/or an overlay, scaled by intensity × envelope. Shake uses seeded noise for determinism.
 */
export const moodEffects = (moods: Mood[], frame: number, fps: number, W: number, seed: string): MoodEffects => {
	const filters: string[] = [];
	let tx = 0;
	let ty = 0;
	let scale = 1;
	let rot = 0;
	const overlays: React.ReactNode[] = [];

	moods.forEach((m, i) => {
		const f = frame - toFrame(m.at, fps);
		const dur = toFrame(m.duration, fps);
		if (f < 0 || f > dur) return;
		const k = envelope(f, dur) * m.intensity;
		const key = `${seed}-${i}`;
		switch (m.kind) {
			case 'anger': {
				const amp = 0.006 * W * k * interpolate(f, [0, dur], [1, 0.3]);
				tx += (random(`${key}-x-${f}`) - 0.5) * 2 * amp;
				ty += (random(`${key}-y-${f}`) - 0.5) * 2 * amp;
				scale *= 1 + 0.07 * k;
				overlays.push(<AbsoluteFill key={key} style={{ backgroundColor: `rgba(255,30,20,${0.32 * k})`, mixBlendMode: 'multiply' }} />);
				break;
			}
			case 'shake': {
				const amp = 0.012 * W * k;
				tx += (random(`${key}-sx-${f}`) - 0.5) * 2 * amp;
				ty += (random(`${key}-sy-${f}`) - 0.5) * 2 * amp;
				rot += (random(`${key}-sr-${f}`) - 0.5) * 1.2 * k;
				break;
			}
			case 'sad':
				filters.push(`saturate(${1 - 0.8 * k})`, `brightness(${1 - 0.12 * k})`);
				overlays.push(<AbsoluteFill key={key} style={{ backgroundColor: `rgba(40,70,120,${0.18 * k})`, mixBlendMode: 'soft-light' }} />);
				scale *= 1 + 0.02 * (f / Math.max(1, dur)) * k;
				break;
			case 'happy':
				filters.push(`brightness(${1 + 0.08 * k})`, `saturate(${1 + 0.25 * k})`);
				overlays.push(<AbsoluteFill key={key} style={{ background: `radial-gradient(circle at 80% 10%, rgba(255,214,10,${0.35 * k}), transparent 55%)`, mixBlendMode: 'screen' }} />);
				break;
			case 'shock': {
				const flash = interpolate(f, [0, 1, 3], [1, 1, 0], { extrapolateRight: 'clamp' });
				overlays.push(<AbsoluteFill key={key} style={{ backgroundColor: `rgba(255,255,255,${flash * k})` }} />);
				scale *= 1 + 0.1 * k * interpolate(f, [0, 6], [1, 0.6], { extrapolateRight: 'clamp' });
				break;
			}
			case 'confusion':
				rot += Math.sin((f / fps) * Math.PI * 2 * 1.2) * 1.5 * k;
				break;
		}
	});

	return {
		filter: filters.length ? filters.join(' ') : 'none',
		transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rot}deg)`,
		overlays,
	};
};
