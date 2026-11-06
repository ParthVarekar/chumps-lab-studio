/**
 * Builds the Phase 2 sample document for the Linux video, 10:01–11:01, from Parakeet word timings.
 * Hand-authored (not AI-planned): it exercises every core component, camera moves and a mood.
 *   npx tsx scripts/samples/make-linux-1001.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPONENT_LIBRARY } from '../../src/components/registry';
import { Edd, type EddInput } from '../../src/edd/schema';
import { exportIcons } from '../export-icons';

const PROJECT = join(process.env.CLS_STUDIO_ROOT ?? 'D:\\ChumpsLabStudio', 'projects', 'sample-linux-1001');
const words: { text: string; start: number }[] = JSON.parse(readFileSync(join(PROJECT, 'words.json'), 'utf8')).words;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Start time of the n-th occurrence of a word (case/punctuation-insensitive), searching after `after`. */
const at = (word: string, after = 0, n = 1): number => {
	let seen = 0;
	for (const w of words) {
		if (w.start >= after && norm(w.text) === norm(word) && ++seen === n) return w.start;
	}
	throw new Error(`word "${word}" not found after ${after}s`);
};
const LEAD = 0.5; // your measured habit: visuals land ~0.5 s before their word
const cue = (word: string, beatStart: number, after = beatStart) => Math.max(0, at(word, after) - LEAD - beatStart);

exportIcons(join(PROJECT, 'media', 'icons'), ['linux', 'openai', 'zorin', 'gimp', 'adobephotoshop']);

const b2 = at('There');
const b3 = at('first', b2) - 0.25; // "So first one was…"
const b4 = at('What', b3);
const b5 = at("I'll", b4);
const b6 = at('As', b5);
const END = 60;
const footage = (start: number) => ({ kind: 'video' as const, src: 'media/footage.mp4', from: start });

const doc: EddInput = {
	version: 1,
	componentLibrary: COMPONENT_LIBRARY,
	format: { width: 1920, height: 1080, fps: 30 },
	look: 'footage-first',
	audio: { voice: { src: 'media/narration.m4a', start: 0, from: 0 } },
	beats: [
		{
			id: 'b1-explore', start: 0, end: b2, intent: 'Installation is done; now we explore', base: footage(0),
			layers: [
				{ id: 'explore', component: 'KineticWord', props: { text: 'explore', uppercase: true }, box: { x: 15, y: 38, w: 70, h: 24 },
					enter: { at: cue('explore', 0), preset: 'pop' }, exit: { at: cue('Linux', 0) - 0.05, preset: 'cut' } },
				{ id: 'tux', component: 'PopImage', props: { src: 'media/icons/linux.svg' }, box: { x: 40, y: 28, w: 20, h: 40 },
					enter: { at: cue('Linux', 0), preset: 'pop' }, exit: { at: b2 - 0.6, preset: 'scale-out' } },
			],
		},
		{
			id: 'b2-chatgpt', start: b2, end: b3, intent: 'ChatGPT suggested a to-do list', base: footage(b2),
			layers: [
				{ id: 'gpt', component: 'PopImage', props: { src: 'media/icons/openai.svg' }, box: { x: 42, y: 30, w: 16, h: 30 },
					enter: { at: cue('chat', b2), preset: 'pop' }, exit: { at: cue('chat', b2) + 1.6, preset: 'scale-out' } },
				{ id: 'todo', component: 'EvidenceCard', props: { src: 'media/todo.png', highlight: { x: 2, y: 22, w: 95, h: 8 } },
					box: { x: 18, y: 12, w: 64, h: 76 }, enter: { at: cue('chat', b2) + 1.9, preset: 'scale-in', durationFrames: 12 },
					exit: { at: cue('Zorin', b2) - 0.1, preset: 'fade' } },
				{ id: 'zorin', component: 'PopImage', props: { src: 'media/icons/zorin.svg' }, box: { x: 41, y: 30, w: 18, h: 34 },
					enter: { at: cue('Zorin', b2), preset: 'pop', direction: 'up' }, exit: { at: b3 - b2 - 0.4, preset: 'fade' } },
			],
		},
		{
			id: 'b3-store', start: b3, end: b4, intent: 'Task 1: install an app from the Software Center', base: footage(b3),
			camera: [{ at: cue('store', b3) + 0.3, to: { x: 14, y: 30, w: 72, h: 40.5 }, inFrames: 6, hold: 3.2, outFrames: 10 }],
			layers: [
				{ id: 'step', component: 'Header', props: { text: '1. Install an app', variant: 'header', align: 'left', color: 'accent' },
					box: { x: 3, y: 4, w: 34, h: 6 }, z: 20, enter: { at: cue('Install', b3), preset: 'slide', direction: 'left', durationFrames: 7 } },
				{ id: 'certified', component: 'UILabel', space: 'stage', props: { text: 'Linux-certified apps', target: { x: 17, y: 40, w: 66, h: 21 } },
					box: { x: 36, y: 63, w: 28, h: 6 }, enter: { at: cue('certified', b3), preset: 'pop' }, exit: { at: cue('search', b3), preset: 'fade' } },
			],
		},
		{
			id: 'b4-gimp', start: b4, end: b5, intent: 'GIMP is the open-source Photoshop', base: footage(b4),
			layers: [
				{ id: 'gimp', component: 'PopImage', props: { src: 'media/icons/gimp.svg' }, box: { x: 6, y: 58, w: 14, h: 26 },
					enter: { at: cue('GIMP', b4), preset: 'pop', direction: 'left' } },
				{ id: 'ps', component: 'PopImage', props: { src: 'media/icons/adobephotoshop.svg' }, box: { x: 80, y: 58, w: 14, h: 26 },
					enter: { at: cue('Photoshop', b4), preset: 'slide', direction: 'right', durationFrames: 7 } },
				{ id: 'meme', component: 'MemeCut', props: { src: 'media/meme_placeholder.png' }, box: { x: 0, y: 0, w: 100, h: 100 }, z: 50,
					enter: { at: cue('works', b4), preset: 'cut' }, exit: { at: cue('works', b4) + 1.4, preset: 'cut' } },
			],
			moods: [{ kind: 'happy', at: cue('well', b4), duration: 1.6, intensity: 0.6 }],
		},
		{
			id: 'b5-customize', start: b5, end: b6, intent: 'Customisation: Zorin Appearance', base: footage(b5),
			camera: [{ at: cue('appearance', b5) + 0.2, to: { x: 18, y: 52, w: 44, h: 24.75 }, inFrames: 6, hold: 1.8, outFrames: 10, tiltDeg: 4 }],
			layers: [
				{ id: 'customize', component: 'Title', props: { text: 'customize', uppercase: true }, box: { x: 10, y: 38, w: 80, h: 22 }, z: 20,
					enter: { at: cue('customization', b5), preset: 'slide-blur', direction: 'left', durationFrames: 9 },
					exit: { at: cue('customization', b5) + 1.5, preset: 'slide', durationFrames: 6 } },
			],
		},
		{
			id: 'b6-accent', start: b6, end: END, intent: 'Layouts and accent colours', base: footage(b6),
			layers: [
				{ id: 'blue', component: 'ColorChip', props: { color: '#0A84FF', label: 'blue' }, box: { x: 86, y: 8, w: 9, h: 16 }, z: 20,
					enter: { at: cue('blue', b6), preset: 'pop' }, exit: { at: cue('purple', b6) - 0.05, preset: 'cut' } },
				{ id: 'purple', component: 'ColorChip', props: { color: '#AF52DE', label: 'purple' }, box: { x: 86, y: 8, w: 9, h: 16 }, z: 20,
					enter: { at: cue('purple', b6), preset: 'pop' } },
			],
		},
	],
};

const edd = Edd.parse(doc);
writeFileSync(join(PROJECT, 'edd.json'), JSON.stringify(edd, null, 1));
console.log(`wrote ${join(PROJECT, 'edd.json')}: ${edd.beats.length} beats, ${edd.beats.reduce((n, b) => n + b.layers.length, 0)} layers`);
for (const b of edd.beats) console.log(`  ${b.id.padEnd(14)} ${b.start.toFixed(2)}–${b.end.toFixed(2)} s`);
