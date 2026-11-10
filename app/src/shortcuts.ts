/**
 * Keyboard map, following Adobe Premiere Pro's defaults wherever the editor has the same idea, so the muscle memory carries over.
 * Where Premiere has no equivalent (lock, assistant) the key is noted in the table as "ours".
 * `SHORTCUTS` feeds the help sheet (press ?), so the sheet can never drift from the code that handles the keys.
 */
import { useEffect } from 'react';
import { allItemIds, find, metaOfItem, oneOfEach, rangeOps, rippleOps, spanOf } from '../shared/ops';
import { useStudio } from './store';

export const SHORTCUTS: { group: string; keys: string; does: string }[] = [
	{ group: 'Playback', keys: 'Space', does: 'Play / pause' },
	{ group: 'Playback', keys: 'J  K  L', does: 'Shuttle: play backwards, stop, play forwards (press J or L again for 2×, 4×)' },
	{ group: 'Playback', keys: '←  →', does: 'Step one frame (Shift: five frames)' },
	{ group: 'Playback', keys: '↑  ↓', does: 'Previous / next edit point' },
	{ group: 'Playback', keys: 'Home  End', does: 'Go to start / end' },
	{ group: 'Marks', keys: 'I  O', does: 'Mark In / Mark Out at the playhead' },
	{ group: 'Marks', keys: 'X', does: 'Mark the selected item (In and Out around it)' },
	{ group: 'Marks', keys: 'Alt+I  Alt+O  Alt+X', does: 'Clear In / Out / both' },
	{ group: 'Marks', keys: ';  \'', does: 'Lift (remove what is between In and Out) / Extract (same, and close the gap)' },
	{ group: 'Markers', keys: 'M', does: 'Add a marker at the playhead' },
	{ group: 'Markers', keys: 'Shift+M  Ctrl+Shift+M', does: 'Go to next / previous marker' },
	{ group: 'Markers', keys: 'Ctrl+Alt+M', does: 'Delete the marker at the playhead' },
	{ group: 'Tools', keys: 'V', does: 'Selection tool' },
	{ group: 'Tools', keys: 'C', does: 'Razor tool: click a clip to cut it there (V or Esc to leave)' },
	{ group: 'Tools', keys: 'A', does: 'Select everything from the playhead onwards' },
	{ group: 'Editing', keys: 'Ctrl+K', does: 'Add edit: cut the selected items (or everything under the playhead) at the playhead' },
	{ group: 'Editing', keys: 'Q  W', does: 'Trim the selected item\'s start / end to the playhead' },
	{ group: 'Editing', keys: '[  ]', does: 'Same as Q / W' },
	{ group: 'Editing', keys: 'Delete', does: 'Remove the selection' },
	{ group: 'Editing', keys: 'Shift+Delete', does: 'Ripple delete: remove and close the gap' },
	{ group: 'Editing', keys: 'Alt+←  Alt+→', does: 'Nudge the selection one frame (Shift: a second)' },
	{ group: 'Editing', keys: 'Ctrl+C  Ctrl+X  Ctrl+V', does: 'Copy / cut / paste at the playhead' },
	{ group: 'Editing', keys: 'Ctrl+D', does: 'Duplicate' },
	{ group: 'Editing', keys: 'Ctrl+G  Ctrl+Shift+G', does: 'Group / ungroup' },
	{ group: 'Editing', keys: 'E  or  Shift+E', does: 'Enable / disable (turn off without deleting)' },
	{ group: 'Editing', keys: 'Ctrl+L', does: 'Lock / unlock (ours)' },
	{ group: 'Selection', keys: 'Ctrl+A  Ctrl+Shift+A', does: 'Select all / deselect all' },
	{ group: 'Timeline', keys: 'S', does: 'Snapping on / off' },
	{ group: 'Timeline', keys: '=  -', does: 'Zoom the timeline in / out' },
	{ group: 'Timeline', keys: '\\', does: 'Zoom the timeline to fit' },
	{ group: 'General', keys: 'Ctrl+Z  Ctrl+Shift+Z', does: 'Undo / redo' },
	{ group: 'General', keys: '/', does: 'Ask the assistant (ours)' },
	{ group: 'General', keys: '?', does: 'This sheet' },
	{ group: 'General', keys: 'Esc', does: 'Cancel, leave the razor, deselect' },
];

const SPEEDS = [1, 2, 4];
const FRAMES_BIG = 5;

/** Every moment worth jumping to: each item's start and end, the beat joins and the markers. */
export function editPoints(edd: NonNullable<ReturnType<typeof useStudio.getState>['edd']>): number[] {
	const pts = new Set<number>([0]);
	for (const id of allItemIds(edd)) { const sp = spanOf(edd, id); if (sp) { pts.add(Math.round(sp.start * 1000) / 1000); pts.add(Math.round(sp.end * 1000) / 1000); } }
	for (const b of edd.beats) { pts.add(b.start); pts.add(b.end); }
	for (const m of edd.markers) pts.add(m.at);
	return [...pts].sort((a, b) => a - b);
}

let clipboard: string[] = [];

function shuttle(dir: 1 | -1) {
	const st = useStudio.getState();
	const cur = st.rate;
	const next = (r: number) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(Math.abs(r)) + 1)];
	if (dir === 1) {
		const speed = cur > 0 && st.playing ? next(cur) : 1;
		st.set({ rate: speed });
		st.playPause(true);
	} else {
		st.playPause(false);
		st.set({ rate: cur < 0 ? -next(cur) : -1 });
	}
}

function stopShuttle() {
	const st = useStudio.getState();
	st.playPause(false);
	if (st.rate !== 1) st.set({ rate: 1 });
}

export function useShortcuts() {
	// Reverse play: the preview player cannot run backwards, so step the playhead back in real time.
	useEffect(() => {
		let last = performance.now();
		const id = setInterval(() => {
			const now = performance.now();
			const dt = (now - last) / 1000;
			last = now;
			const st = useStudio.getState();
			if (st.rate >= 0) return;
			const t = st.time + st.rate * dt;
			if (t <= 0) { st.seekTo(0); st.set({ rate: 1 }); } else st.seekTo(t);
		}, 33);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
			const st = useStudio.getState();
			const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
			const mod = e.ctrlKey || e.metaKey;
			if (e.key === 'Escape') {
				if (st.dialog) st.set({ dialog: null });
				else if (st.help) st.set({ help: false });
				else if (st.pick) st.set({ pick: null, status: '' });
				else if (st.draft) st.discard();
				else if (st.tool === 'razor') st.set({ tool: 'select', status: '' });
				else st.select([]);
				return;
			}
			if (key === '/' && !typing) {
				e.preventDefault();
				st.set({ rightTab: 'assistant' });
				setTimeout(() => window.dispatchEvent(new Event('focus-assistant')), 30);
				return;
			}
			if (mod && key === 'z' && !typing) { e.preventDefault(); void (e.shiftKey ? st.redo() : st.undo()); return; }
			if (mod && key === 'y' && !typing) { e.preventDefault(); void st.redo(); return; }
			if (typing || !st.edd) return;
			const edd = st.edd;
			const fps = edd.format.fps;
			const total = edd.beats[edd.beats.length - 1].end;
			const sel = st.selection.filter((id) => find(edd, id));
			const go = (x: number) => st.seekTo(Math.max(0, Math.min(total, x)));
			const run = (ops: Parameters<typeof st.run>[0]) => { if (ops.length) void st.run(ops); };
			const now = st.time;
			const stop = () => e.preventDefault();

			// ---- playback
			if (e.key === ' ') { stop(); if (st.rate < 0) stopShuttle(); else { if (st.playing && st.rate !== 1) st.set({ rate: 1 }); st.playPause(); } return; }
			if (!mod && !e.altKey && key === 'l') { stop(); shuttle(1); return; }
			if (!mod && !e.altKey && key === 'j') { stop(); shuttle(-1); return; }
			if (!mod && !e.altKey && key === 'k') { stop(); stopShuttle(); return; }
			if (e.key === 'ArrowLeft' && !mod && !e.altKey) { stop(); go(now - (e.shiftKey ? FRAMES_BIG : 1) / fps); return; }
			if (e.key === 'ArrowRight' && !mod && !e.altKey) { stop(); go(now + (e.shiftKey ? FRAMES_BIG : 1) / fps); return; }
			if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
				stop();
				const pts = editPoints(edd);
				const target = e.key === 'ArrowUp' ? [...pts].reverse().find((p) => p < now - 0.5 / fps) : pts.find((p) => p > now + 0.5 / fps);
				if (target !== undefined) go(target);
				return;
			}
			if (e.key === 'Home') { go(0); return; }
			if (e.key === 'End') { go(total); return; }

			// ---- nudge
			if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel.length) {
				stop();
				const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps);
				run(oneOfEach(edd, sel).map((id) => ({ id, sp: spanOf(edd, id) })).filter((x) => x.sp).map((x) => ({ op: 'set_time' as const, id: x.id, start: Math.max(0, x.sp!.start + d) })));
				return;
			}

			// ---- In / Out marks, lift and extract
			if (!mod && !e.altKey && key === 'i') { st.set({ range: { in: now, out: st.range.out !== null && st.range.out <= now ? null : st.range.out } }); return; }
			if (!mod && !e.altKey && key === 'o') { st.set({ range: { in: st.range.in !== null && st.range.in >= now ? null : st.range.in, out: now } }); return; }
			if (e.altKey && !mod && key === 'i') { st.set({ range: { ...st.range, in: null } }); return; }
			if (e.altKey && !mod && key === 'o') { st.set({ range: { ...st.range, out: null } }); return; }
			if (e.altKey && !mod && key === 'x') { st.set({ range: { in: null, out: null } }); return; }
			if (!mod && !e.altKey && key === 'x') {
				const spans = sel.map((id) => spanOf(edd, id)).filter((x): x is { start: number; end: number } => !!x);
				if (spans.length) st.set({ range: { in: Math.min(...spans.map((x) => x.start)), out: Math.max(...spans.map((x) => x.end)) } });
				return;
			}
			if (key === ';' || key === "'") {
				stop();
				const { in: a, out: b } = st.range;
				if (a === null || b === null) { st.set({ status: 'Mark an In (I) and an Out (O) first' }); return; }
				run(rangeOps(edd, a, b, key === "'"));
				st.set({ range: { in: null, out: null } });
				return;
			}

			// ---- markers
			if (key === 'm' && !mod && !e.shiftKey) { stop(); run([{ op: 'add_marker', at: now }]); return; }
			if (key === 'm' && (e.shiftKey || (mod && e.shiftKey)) && !e.altKey) {
				stop();
				const ts = edd.markers.map((k) => k.at).sort((a, b) => a - b);
				const target = mod ? [...ts].reverse().find((x) => x < now - 0.05) : ts.find((x) => x > now + 0.05);
				if (target !== undefined) go(target);
				return;
			}
			if (key === 'm' && mod && e.altKey) {
				stop();
				const near = edd.markers.find((k) => Math.abs(k.at - now) < 0.3);
				if (near) run([{ op: 'remove_marker', id: near.id }]);
				return;
			}
			if (mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && edd.markers.length) {
				stop();
				const ts = edd.markers.map((k) => k.at).sort((a, b) => a - b);
				const target = e.key === 'ArrowLeft' ? [...ts].reverse().find((x) => x < now - 0.05) : ts.find((x) => x > now + 0.05);
				if (target !== undefined) go(target);
				return;
			}

			// ---- tools and selection
			if (!mod && !e.altKey && key === 'v') { st.set({ tool: 'select', status: '' }); return; }
			if (!mod && !e.altKey && key === 'c') { st.set({ tool: 'razor', status: 'Razor: click a clip to cut it there. V or Esc leaves.' }); return; }
			if (!mod && !e.altKey && key === 'a') { st.select(allItemIds(edd).filter((id) => { const sp = spanOf(edd, id); return sp && sp.start >= now - 0.02; })); return; }
			if (mod && key === 'a') { stop(); st.select(e.shiftKey ? [] : allItemIds(edd)); return; }

			// ---- editing
			if (mod && key === 'k') {
				stop();
				const pool = sel.length ? sel : allItemIds(edd);
				run(pool.filter((id) => find(edd, id)?.kind === 'layer').filter((id) => { const sp = spanOf(edd, id)!; return now > sp.start + 0.16 && now < sp.end - 0.16; }).map((id) => ({ op: 'split' as const, id, at: now })));
				return;
			}
			if (!mod && !e.altKey && (key === 'q' || key === 'w' || key === '[' || key === ']')) {
				const start = key === 'q' || key === '[';
				run(oneOfEach(edd, sel).map((id) => ({ id, sp: spanOf(edd, id) })).filter((x) => x.sp && now > x.sp.start + 0.16 && now < x.sp.end - 0.05)
					.map((x) => (start ? { op: 'set_time' as const, id: x.id, start: now } : { op: 'set_time' as const, id: x.id, end: Math.max(x.sp!.start + 0.2, now) })));
				return;
			}
			if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { stop(); run(e.shiftKey ? rippleOps(edd, sel) : oneOfEach(edd, sel).map((id) => ({ op: 'remove' as const, id }))); return; }
			if (mod && key === 'c' && sel.length) { clipboard = oneOfEach(edd, sel); st.set({ status: `Copied ${clipboard.length} item${clipboard.length === 1 ? '' : 's'}. Ctrl+V pastes at the playhead` }); return; }
			if (mod && key === 'x' && sel.length) {
				stop();
				clipboard = oneOfEach(edd, sel);
				st.set({ status: `Cut ${clipboard.length} item${clipboard.length === 1 ? '' : 's'}. Ctrl+V pastes at the playhead` });
				run(clipboard.map((id) => ({ op: 'remove' as const, id })));
				return;
			}
			if (mod && key === 'v' && clipboard.length) {
				stop();
				const live = clipboard.map((id) => ({ id, sp: spanOf(edd, id) })).filter((x) => x.sp);
				if (!live.length) { st.set({ status: 'What you copied no longer exists (a cut item is gone: paste before changing it)' }); return; }
				const first = Math.min(...live.map((x) => x.sp!.start));
				run(live.map((x) => ({ op: 'duplicate' as const, id: x.id, at: Math.max(0, now + (x.sp!.start - first)) })));
				return;
			}
			if (mod && key === 'd' && sel.length) { stop(); run(oneOfEach(edd, sel).map((id) => ({ op: 'duplicate' as const, id }))); return; }
			if (mod && key === 'g' && sel.length) {
				stop();
				if (e.shiftKey) run([{ op: 'ungroup', id: sel[0] }]);
				else if (sel.length > 1) run([{ op: 'group', ids: sel }]);
				return;
			}
			if (key === 'e' && !mod && sel.length) {
				const off = sel.every((id) => metaOfItem(edd, id)?.disabled);
				run(oneOfEach(edd, sel).map((id) => ({ op: 'set_enabled' as const, id, enabled: !!off })));
				return;
			}
			if (key === 'l' && mod && sel.length) {
				stop();
				const all = sel.every((id) => metaOfItem(edd, id)?.locked);
				run(sel.map((id) => ({ op: 'lock' as const, id, locked: !all })));
				return;
			}
			if (mod && key === 's') { stop(); st.set({ status: 'Everything saves as you edit. Ctrl+Z undoes.' }); return; }

			// ---- timeline view
			if (key === 's' && !mod && !e.altKey) { window.dispatchEvent(new Event('toggle-snap')); return; }
			if (e.key === '+' || e.key === '=') { st.set({ zoom: Math.min(240, st.zoom * 1.3) }); return; }
			if (e.key === '-') { st.set({ zoom: Math.max(8, st.zoom / 1.3) }); return; }
			if (e.key === '\\') { window.dispatchEvent(new Event('fit-timeline')); return; }
			if (e.key === '?') { st.set({ help: !st.help }); return; }
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
}
