import type { Beat, Edd } from './schema';

/** Seconds → frame index. Every time in an EDD goes through this one rounding rule. */
export const toFrame = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** First frame and length of a beat on the global timeline (beats tile the timeline exactly). */
export const beatFrameRange = (beat: Beat, fps: number) => {
	const from = toFrame(beat.start, fps);
	const to = toFrame(beat.end, fps);
	return { from, durationInFrames: Math.max(1, to - from) };
};

export const totalFrames = (edd: Edd): number => toFrame(edd.beats[edd.beats.length - 1].end, edd.format.fps);
