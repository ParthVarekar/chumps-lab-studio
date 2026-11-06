import { Edd } from './edd/schema';
import { COMPONENT_LIBRARY } from './components/registry';

/** A 6-second document with no external media, so Remotion Studio opens without a media server. */
export const DEMO_EDD: Edd = Edd.parse({
	version: 1,
	componentLibrary: COMPONENT_LIBRARY,
	format: { width: 1920, height: 1080, fps: 30 },
	look: 'footage-first',
	audio: {},
	beats: [
		{
			id: 'demo-1',
			start: 0,
			end: 3,
			base: { kind: 'color', color: '#16181D' },
			layers: [
				{ id: 't1', component: 'Title', props: { text: 'Chumps Lab Studio' }, box: { x: 10, y: 38, w: 80, h: 22 }, enter: { at: 0.2, preset: 'slide-blur', direction: 'left', durationFrames: 9 } },
				{ id: 'c1', component: 'ColorChip', props: { color: '#0A84FF', label: 'blue' }, box: { x: 44, y: 66, w: 12, h: 18 }, enter: { at: 1.2, preset: 'pop' } },
			],
		},
		{
			id: 'demo-2',
			start: 3,
			end: 6,
			base: { kind: 'color', color: '#0B0B0C' },
			camera: [{ at: 0.6, to: { x: 30, y: 30, w: 40, h: 40 }, inFrames: 6, hold: 1.2, outFrames: 10 }],
			layers: [
				{ id: 'w1', component: 'KineticWord', props: { text: 'zoom', uppercase: true }, box: { x: 20, y: 35, w: 60, h: 30 }, space: 'stage', enter: { at: 0.1, preset: 'pop' } },
			],
			moods: [{ kind: 'anger', at: 2.2, duration: 0.7, intensity: 0.7 }],
		},
	],
});
