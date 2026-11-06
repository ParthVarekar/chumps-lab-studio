import { Timeline as XTimeline, type TimelineState } from '@xzdarcy/react-timeline-editor';
import { Copy, ListX, Flag, Eye, EyeOff, Link2, Link2Off, Lock, Minus, Plus, Scissors, Trash2, Unlock, Magnet, Maximize2 } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { fmt, useStudio } from '../store';
import type { Edd } from '@cls/engine/src/edd/schema';
import { find, oneOfEach, rippleOps, spanOf, type Op } from '../../shared/ops';
import { EFFECTS, buildRows } from './timelineModel';

const Waveform: React.FC<{ peaks: number[]; duration: number }> = ({ peaks, duration }) => {
	if (!peaks.length) return null;
	const n = peaks.length;
	let d = '';
	peaks.forEach((p, i) => {
		const x = (i / n) * 100;
		const h = Math.max(0.04, p) * 48;
		d += `M${x.toFixed(3)} ${50 - h}V${50 + h}`;
	});
	return (
		<svg className="wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
			<path d={d} stroke="currentColor" strokeWidth="0.12" vectorEffect="non-scaling-stroke" fill="none" />
			<title>{`narration, ${fmt(duration)}`}</title>
		</svg>
	);
};

/** A lane's name; clicking it switches every item in the lane off (or back on), like muting a track. */
const LaneLabel: React.FC<{ row: { id: string; rowHeight?: number; actions: { id: string }[] }; kind?: string; label?: string; items: Record<string, { disabled?: boolean }>; edd: Edd | null; run: (ops: Op[]) => unknown }> = ({ row, kind, label, items, edd, run }) => {
	const ids = row.actions.map((a) => a.id).filter((id) => items[id]);
	const allOff = ids.length > 0 && ids.every((id) => items[id].disabled);
	return (
		<div className={`tl-label k-${kind}${allOff ? ' muted' : ''}${ids.length ? ' mutable' : ''}`} style={{ height: row.rowHeight ?? 30 }}
			title={ids.length ? (allOff ? 'Lane is off: click to switch it back on' : 'Click to switch this whole lane off (mute / hide)') : undefined}
			onClick={() => { if (edd && ids.length) void run(oneOfEach(edd, ids).map((id) => ({ op: 'set_enabled' as const, id, enabled: allOff }))); }}>
			{label}
		</div>
	);
};

/** A stable colour slot (0-5) per group tag, so linked clips share a stripe colour. */
const hue = (g: string) => [...g].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 6;

export const TimelinePanel: React.FC = () => {
	const edd = useStudio((s) => s.draft?.edd ?? s.edd);
	const real = useStudio((s) => s.edd);
	const draft = useStudio((s) => s.draft);
	const selection = useStudio((s) => s.selection);
	const zoom = useStudio((s) => s.zoom);
	const dir = useStudio((s) => s.dir);
	const set = useStudio((s) => s.set);
	const select = useStudio((s) => s.select);
	const run = useStudio((s) => s.run);
	const ref = useRef<TimelineState>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const [peaks, setPeaks] = useState<number[]>([]);
	const [scrollTop, setScrollTop] = useState(0);
	const [snap, setSnap] = useState(true);

	const duration = edd ? edd.beats[edd.beats.length - 1].end : 0;
	const { rows, rowMeta, items } = useMemo(() => (edd ? buildRows(edd, duration) : { rows: [], rowMeta: {}, items: {} }), [edd, duration]);
	const draftIds = useMemo(() => new Set((draft?.notes ?? []).filter((n) => n.ok && n.id).map((n) => n.id!)), [draft]);

	useEffect(() => {
		setPeaks([]);
		if (dir) void api.waveform(dir).then(setPeaks).catch(() => undefined);
	}, [dir]);

	// Playhead: the preview owns time; the timeline follows it.
	useEffect(() => useStudio.subscribe((s, p) => { if (s.time !== p.time) ref.current?.setTime(s.time); }), []);

	const scale = zoom >= 90 ? 1 : zoom >= 35 ? 2 : 5;
	const seek = (t: number) => useStudio.getState().seekTo(Math.max(0, Math.min(duration, t)));
	const fit = () => set({ zoom: Math.max(8, Math.min(240, ((wrap.current?.clientWidth ?? 900) - 140) / Math.max(1, duration))) });

	const sel = selection.filter((id) => real && find(real, id));
	const one = sel.length === 1 ? sel[0] : null;
	const lockedAll = sel.length > 0 && sel.every((id) => items[id]?.locked);

	return (
		<div className="timeline" ref={wrap}>
			<div className="tl-toolbar">
				<button title="Split at playhead (S)" disabled={!one || items[one]?.kind !== 'layer'} onClick={() => one && run([{ op: 'split', id: one, at: useStudio.getState().time }])}><Scissors size={15} /> Split</button>
				<button title="Duplicate (Ctrl+D)" disabled={!sel.length} onClick={() => run(oneOfEach(real!, sel).map((id) => ({ op: 'duplicate' as const, id })))}><Copy size={15} /> Duplicate</button>
				<button title="Delete (Del)" disabled={!sel.length} onClick={() => run(oneOfEach(real!, sel).map((id) => ({ op: 'remove' as const, id })))}><Trash2 size={15} /> Delete</button>
				<button title="Delete and close the gap: later items slide left (Shift+Del)" disabled={!sel.length} onClick={() => run(rippleOps(real!, sel))}><ListX size={15} /> Ripple</button>
				<button title="Lock / unlock (L)" disabled={!sel.length} onClick={() => run(sel.map((id) => ({ op: 'lock' as const, id, locked: !lockedAll })))}>{lockedAll ? <Unlock size={15} /> : <Lock size={15} />} {lockedAll ? 'Unlock' : 'Lock'}</button>
				<button title="Group the selected items so they move, copy, lock and delete together (Ctrl+G)" disabled={sel.length < 2 || sel.every((id) => items[id]?.group && items[id]?.group === items[sel[0]]?.group)} onClick={() => run([{ op: 'group', ids: sel }])}><Link2 size={15} /> Group</button>
				<button title="Release the selected group (Ctrl+Shift+G)" disabled={!sel.some((id) => items[id]?.group)} onClick={() => run([{ op: 'ungroup', id: sel.find((id) => items[id]?.group)! }])}><Link2Off size={15} /> Ungroup</button>
				<button title="Turn the selected items off or on without deleting them (E)" disabled={!sel.length} onClick={() => run(oneOfEach(real!, sel).map((id) => ({ op: 'set_enabled' as const, id, enabled: !!items[id]?.disabled })))}>{sel.length && sel.every((id) => items[id]?.disabled) ? <Eye size={15} /> : <EyeOff size={15} />} {sel.length && sel.every((id) => items[id]?.disabled) ? 'Enable' : 'Disable'}</button>
				<span className="sep" />
				<button className={snap ? 'on' : ''} title="Snap to other items' edges" onClick={() => setSnap(!snap)}><Magnet size={15} /> Snap</button>
				<span className="spacer" />
				<button title="Zoom out (-)" onClick={() => set({ zoom: Math.max(8, zoom / 1.4) })}><Minus size={15} /></button>
				<input className="zoom" type="range" min={8} max={240} value={zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} />
				<button title="Zoom in (+)" onClick={() => set({ zoom: Math.min(240, zoom * 1.4) })}><Plus size={15} /></button>
				<button title="Fit the whole video" onClick={fit}><Maximize2 size={15} /> Fit</button>
			</div>
			<div className="tl-body">
				<div className="tl-labels" style={{ transform: `translateY(${-scrollTop}px)` }}>
					<div className="tl-ruler-gap" />
					{rows.map((r) => (
						<LaneLabel key={r.id} row={r} kind={rowMeta[r.id]?.kind} label={rowMeta[r.id]?.label} items={items} edd={real} run={run} />
					))}
				</div>
				<div className="tl-main">
					{edd ? (
						<XTimeline
							ref={ref}
							editorData={rows}
							effects={EFFECTS}
							scale={scale}
							scaleWidth={zoom * scale}
							scaleSplitCount={scale === 1 ? 10 : scale === 2 ? 4 : 5}
							startLeft={12}
							rowHeight={30}
							gridSnap={snap}
							dragLine={snap}
							autoScroll
							hideCursor={false}
							onScroll={({ scrollTop: st }) => setScrollTop(st)}
							onClickTimeArea={(t) => { seek(t); return true; }}
							onCursorDrag={(t) => seek(t)}
							onClickRow={(e) => { if ((e.target as HTMLElement).closest('.timeline-editor-action')) return; select([]); }}
							onClickAction={(e, { action }) => {
								if (action.id.startsWith('marker:')) { seek(action.start); return; }
								if (!items[action.id]) return;
								const ev = e as unknown as MouseEvent;
								select([action.id], ev.shiftKey || ev.ctrlKey);
							}}
							onActionMoveEnd={({ action, start, end }) => { if (items[action.id]) void run([{ op: 'set_time', id: action.id, start, end: items[action.id].kind === 'sfx' ? undefined : end }]); }}
							onActionResizeEnd={({ action, start, end }) => { if (items[action.id]) void run([{ op: 'set_time', id: action.id, start, end }]); }}
							getActionRender={(action) => {
								if (action.id === 'voice') return <div className="clip clip-voice"><Waveform peaks={peaks} duration={duration} /></div>;
								if (action.id.startsWith('marker:')) return <div className="clip clip-marker" title="Marker: click to jump here. Shift+M at the playhead removes it"><Flag size={10} /><span>{real?.markers.find((k) => k.id === action.id.slice(7))?.label}</span></div>;
								if (action.id.startsWith('beat:')) return <div className="clip clip-beat">{action.id.slice(5)}</div>;
								const m = items[action.id];
								const cls = ['clip', `clip-${action.effectId}`, selection.includes(action.id) ? 'selected' : '', m?.locked ? 'locked' : '', m?.disabled ? 'off' : '', m?.group ? `grouped g-${hue(m.group)}` : '', m?.origin === 'user' ? 'mine' : '', draftIds.has(action.id) ? 'ghost' : ''].filter(Boolean).join(' ');
								return <div className={cls} title={m?.group ? `Grouped (${m.group}): moves, copies and deletes with its group` : undefined}>{m?.locked ? <Lock size={10} /> : null}{m?.group ? <Link2 size={10} /> : null}<span>{m?.label ?? action.effectId}</span></div>;
							}}
							style={{ width: '100%', height: '100%', background: 'transparent' }}
						/>
					) : null}
				</div>
			</div>
			{draft ? <div className="tl-draftbar">Previewing AI change: {draft.label}. Nothing is saved until you accept.</div> : null}
			{real && one && spanOf(real, one) ? null : null}
		</div>
	);
};
