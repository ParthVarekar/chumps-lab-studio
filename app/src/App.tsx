import React, { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { camId, find, metaOfItem, moodId, oneOfEach, spanOf } from '../shared/ops';
import { useStudio } from './store';
import { Assistant } from './ui/Assistant';
import { Inspector } from './ui/Inspector';
import { Library } from './ui/Library';
import { Preview } from './ui/Preview';
import { Review } from './ui/Review';
import { TimelinePanel } from './ui/Timeline';
import { TopBar } from './ui/TopBar';

/** Keyboard shortcuts: the same commands as the buttons, so the AI and the keyboard share one path. */
/** Ctrl+C remembers the selected items (one per group); Ctrl+V pastes them so the earliest lands on the playhead, keeping their spacing. */
let clipboard: string[] = [];

function useShortcuts() {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
			const st = useStudio.getState();
			const fps = st.edd?.format.fps ?? 30;
			if (e.key === 'Escape') {
				if (st.pick) st.set({ pick: null, status: '' });
				else if (st.draft) st.discard();
				else st.select([]);
				return;
			}
			if (e.key === '/' && !typing) {
				e.preventDefault();
				st.set({ rightTab: 'assistant' });
				setTimeout(() => window.dispatchEvent(new Event('focus-assistant')), 30);
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
				e.preventDefault();
				void (e.shiftKey ? st.redo() : st.undo());
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
				e.preventDefault();
				void st.redo();
				return;
			}
			if (typing || !st.edd) return;
			const total = st.edd.beats[st.edd.beats.length - 1].end;
			const sel = st.selection.filter((id) => find(st.edd!, id));
			const go = (t: number) => st.seekTo(Math.max(0, Math.min(total, t)));
			const mod = e.ctrlKey || e.metaKey;
			if (e.key === ' ') { e.preventDefault(); document.querySelector<HTMLButtonElement>('.transport .round')?.click(); }
			else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel.length) {
				// Nudge the selection by a frame (a second with Shift); a grouped item moves its whole group.
				e.preventDefault();
				const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps);
				const lead = oneOfEach(st.edd, sel).map((id) => ({ id, sp: spanOf(st.edd!, id) })).filter((x) => x.sp);
				void st.run(lead.map((x) => ({ op: 'set_time' as const, id: x.id, start: Math.max(0, x.sp!.start + d) })));
			}
			else if (mod && e.key.toLowerCase() === 'a') {
				e.preventDefault();
				const all: string[] = [];
				for (const b of st.edd.beats) {
					b.layers.forEach((l) => { if (!/^continues /.test(String(l.meta?.reason ?? ''))) all.push(l.id); });
					b.camera.forEach((_, i) => all.push(camId(b, i)));
					b.moods.forEach((_, i) => all.push(moodId(b, i)));
				}
				st.select(all);
			}
			else if (mod && e.key.toLowerCase() === 'c' && sel.length) { clipboard = oneOfEach(st.edd, sel); st.set({ status: `Copied ${clipboard.length} item${clipboard.length === 1 ? '' : 's'}. Ctrl+V pastes at the playhead` }); }
			else if (mod && e.key.toLowerCase() === 'v' && clipboard.length) {
				e.preventDefault();
				const live = clipboard.map((id) => ({ id, sp: spanOf(st.edd!, id) })).filter((x) => x.sp);
				if (!live.length) { st.set({ status: 'What you copied no longer exists' }); return; }
				const first = Math.min(...live.map((x) => x.sp!.start));
				void st.run(live.map((x) => ({ op: 'duplicate' as const, id: x.id, at: Math.max(0, st.time + (x.sp!.start - first)) })));
			}
			else if (e.key.toLowerCase() === 'm' && !mod) {
				e.preventDefault();
				if (e.shiftKey) {
					const near = st.edd.markers.find((k) => Math.abs(k.at - st.time) < 0.3);
					if (near) void st.run([{ op: 'remove_marker', id: near.id }]);
				} else void st.run([{ op: 'add_marker', at: st.time }]);
			}
			else if (mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && st.edd.markers.length) {
				// Jump to the previous / next marker.
				e.preventDefault();
				const ts = st.edd.markers.map((k) => k.at).sort((a, b) => a - b);
				const target = e.key === 'ArrowLeft' ? [...ts].reverse().find((t) => t < st.time - 0.05) : ts.find((t) => t > st.time + 0.05);
				if (target !== undefined) go(target);
			}
			else if (e.key === 'ArrowLeft') { e.preventDefault(); go(st.time - (e.shiftKey ? 1 : 1 / fps)); }
			else if (e.key === 'ArrowRight') { e.preventDefault(); go(st.time + (e.shiftKey ? 1 : 1 / fps)); }
			else if (e.key === 'Home') go(0);
			else if (e.key === 'End') go(total);
			else if (e.key === '+' || e.key === '=') st.set({ zoom: Math.min(240, st.zoom * 1.3) });
			else if (e.key === '-') st.set({ zoom: Math.max(8, st.zoom / 1.3) });
			else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); void st.run(oneOfEach(st.edd!, sel).map((id) => ({ op: 'remove' as const, id }))); }
			else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel.length) { e.preventDefault(); void st.run(oneOfEach(st.edd!, sel).map((id) => ({ op: 'duplicate' as const, id }))); }
			else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && sel.length) {
				e.preventDefault();
				if (e.shiftKey) void st.run([{ op: 'ungroup', id: sel[0] }]);
				else if (sel.length > 1) void st.run([{ op: 'group', ids: sel }]);
			}
			else if (e.key.toLowerCase() === 'e' && sel.length && !mod) {
				const off = sel.every((id) => (metaOfItem(st.edd!, id) as { disabled?: boolean } | null)?.disabled);
				void st.run(oneOfEach(st.edd, sel).map((id) => ({ op: 'set_enabled' as const, id, enabled: off })));
			}
			else if (e.key.toLowerCase() === 's' && sel.length === 1 && !e.ctrlKey) void st.run([{ op: 'split', id: sel[0], at: st.time }]);
			else if (e.key.toLowerCase() === 'l' && sel.length) {
				const all = sel.every((id) => { const f = find(st.edd!, id)!; return f.kind === 'layer' ? f.layer!.meta.locked : f.kind === 'camera' ? f.beat!.camera[f.index!].meta.locked : f.kind === 'mood' ? f.beat!.moods[f.index!].meta.locked : f.sfx!.meta.locked; });
				void st.run(sel.map((id) => ({ op: 'lock' as const, id, locked: !all })));
			} else if ((e.key === '[' || e.key === ']') && sel.length === 1) {
				const sp = spanOf(st.edd, sel[0]);
				if (sp) void st.run([e.key === '[' ? { op: 'set_time', id: sel[0], start: st.time } : { op: 'set_time', id: sel[0], end: Math.max(sp.start + 0.2, st.time) }]);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
}

export const App: React.FC = () => {
	const init = useStudio((s) => s.init);
	const status = useStudio((s) => s.status);
	const rightTab = useStudio((s) => s.rightTab);
	const set = useStudio((s) => s.set);
	const draft = useStudio((s) => s.draft);
	const pending = useStudio((s) => s.msgs.some((m) => m.state === 'pending'));
	useEffect(() => { void init(); }, [init]);
	useShortcuts();
	return (
		<div className="app">
			<TopBar />
			<Group orientation="vertical" className="vgroup">
				<Panel defaultSize="66%" minSize="35%">
					<Group orientation="horizontal" className="hgroup">
						<Panel defaultSize="22%" minSize="16%" maxSize="38%"><Library /></Panel>
						<Separator className="sep" />
						<Panel defaultSize="54%" minSize="30%"><Preview /></Panel>
						<Separator className="sep" />
						<Panel defaultSize="24%" minSize="18%" maxSize="42%">
							<div className="side">
								<div className="tabs">
									<button className={rightTab === 'inspector' ? 'on' : ''} onClick={() => set({ rightTab: 'inspector' })}>Inspector</button>
									<button className={rightTab === 'assistant' ? 'on' : ''} onClick={() => set({ rightTab: 'assistant' })}>Assistant{pending || draft ? <i className="dot" /> : null}</button>
									<button className={rightTab === 'review' ? 'on' : ''} onClick={() => set({ rightTab: 'review' })}>Review</button>
								</div>
								<div className="sidebody">{rightTab === 'inspector' ? <Inspector /> : rightTab === 'assistant' ? <Assistant /> : <Review />}</div>
							</div>
						</Panel>
					</Group>
				</Panel>
				<Separator className="sep h" />
				<Panel defaultSize="34%" minSize="18%"><TimelinePanel /></Panel>
			</Group>
			<footer className="statusbar"><span>{status}</span></footer>
		</div>
	);
};
