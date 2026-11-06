import { Player, type PlayerRef } from '@remotion/player';
import { ChevronLeft, ChevronRight, Frame, Pause, Play, Volume2, VolumeX, Crosshair } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import { EddVideo } from '@cls/engine/src/compositions/EddVideo';
import { cameraAt } from '@cls/engine/src/motion/camera';
import { totalFrames } from '@cls/engine/src/edd/timing';
import { find, type Op } from '../../shared/ops';
import { fmt, useStudio, type Region } from '../store';
import { EFFECT_TILES, placeOp, type Tile } from './tiles';

const pct = (n: number) => `${n}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const KEEP_RATIO = new Set(['PopImage', 'MemeSticker', 'MemeCut']);

export const Preview: React.FC = () => {
	const edd = useStudio((s) => s.draft?.edd ?? s.edd);
	const draft = useStudio((s) => s.draft);
	const assetBase = useStudio((s) => s.assetBase);
	const selection = useStudio((s) => s.selection);
	const guides = useStudio((s) => s.guides);
	const pick = useStudio((s) => s.pick);
	const playing = useStudio((s) => s.playing);
	const time = useStudio((s) => s.time);
	const set = useStudio((s) => s.set);
	const run = useStudio((s) => s.run);
	const place = useStudio((s) => s.place);
	const accept = useStudio((s) => s.accept);
	const discard = useStudio((s) => s.discard);

	const player = useRef<PlayerRef>(null);
	const box = useRef<HTMLDivElement>(null);
	const overlay = useRef<HTMLDivElement>(null);
	const target = useRef<HTMLDivElement>(null);
	const moveable = useRef<Moveable>(null);
	const [size, setSize] = useState({ w: 640, h: 360 });
	const [muted, setMuted] = useState(false);
	const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	const [labelFor, setLabelFor] = useState<Region | null>(null);
	const [labelText, setLabelText] = useState('');
	const [, force] = useState(0);

	const fps = edd?.format.fps ?? 30;
	const ratio = edd ? edd.format.width / edd.format.height : 16 / 9;

	// Fit the 16:9 stage inside the available space.
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			const w = el.clientWidth;
			const h = el.clientHeight;
			const sw = Math.min(w, h * ratio);
			setSize({ w: Math.max(200, Math.floor(sw)), h: Math.max(112, Math.floor(sw / ratio)) });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [ratio, !!edd]);

	// Time and transport come from the Player's own events.
	useEffect(() => {
		const p = player.current;
		if (!p) return;
		const onFrame = (e: { detail: { frame: number } }) => set({ time: e.detail.frame / fps });
		const onPlay = () => set({ playing: true });
		const onPause = () => set({ playing: false });
		p.addEventListener('frameupdate', onFrame);
		p.addEventListener('play', onPlay);
		p.addEventListener('pause', onPause);
		set({
			seekTo: (t: number) => {
				player.current?.seekTo(Math.round(t * fps));
				set({ time: t });
			},
		});
		return () => {
			p.removeEventListener('frameupdate', onFrame);
			p.removeEventListener('play', onPlay);
			p.removeEventListener('pause', onPause);
		};
	}, [fps, set, edd?.beats.length]);

	const toggle = useCallback(() => player.current?.toggle(), []);
	const step = (frames: number) => {
		player.current?.pause();
		player.current?.seekTo(Math.max(0, Math.round(useStudio.getState().time * fps) + frames));
	};
	useEffect(() => { if (muted) player.current?.mute(); else player.current?.unmute(); }, [muted]);

	// Camera view at the playhead: stage-space layers only make sense to drag while the camera is idle.
	const cam = useMemo(() => {
		if (!edd) return { scale: 1, view: { x: 0, y: 0, w: 100, h: 100 } };
		const b = edd.beats.find((x) => time >= x.start && time < x.end) ?? edd.beats[0];
		const c = cameraAt(b.camera.map((m) => ({ ...m, at: m.at })), Math.round((time - b.start) * fps), fps, edd.format.width, edd.format.height);
		return { scale: c.scale, view: c.view };
	}, [edd, time, fps]);

	// ---- the selected layer's handles
	const one = selection.length === 1 ? selection[0] : null;
	const found = edd && one ? find(edd, one) : null;
	const layer = found?.kind === 'layer' ? found.layer! : null;
	const isStage = layer?.space === 'stage';
	const live = layer && (time >= (found!.beat!.start + layer.enter.at) - 0.01) && (!layer.exit || time <= found!.beat!.start + layer.exit.at + 0.3);
	const handlesOn = !!layer && !!live && !drag && !pick && (!isStage || cam.scale < 1.001) && !draft;

	const commitBox = () => {
		const t = target.current;
		const o = overlay.current;
		if (!t || !o || !one) return;
		const r = t.getBoundingClientRect();
		const ob = o.getBoundingClientRect();
		const nb = {
			x: round2(((r.left - ob.left) / ob.width) * 100),
			y: round2(((r.top - ob.top) / ob.height) * 100),
			w: round2((r.width / ob.width) * 100),
			h: round2((r.height / ob.height) * 100),
		};
		t.style.transform = '';
		void run([{ op: 'set_box', id: one, box: nb }]);
	};

	// ---- region picking (zoom / label / assistant)
	const point = (e: React.PointerEvent) => {
		const ob = overlay.current!.getBoundingClientRect();
		return { x: Math.max(0, Math.min(100, ((e.clientX - ob.left) / ob.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - ob.top) / ob.height) * 100)) };
	};
	const toStage = (r: Region): Region => ({ x: round2(cam.view.x + (r.x * cam.view.w) / 100), y: round2(cam.view.y + (r.y * cam.view.h) / 100), w: round2((r.w * cam.view.w) / 100), h: round2((r.h * cam.view.h) / 100) });
	const finishPick = (a: { x0: number; y0: number; x1: number; y1: number }) => {
		const r: Region = { x: Math.min(a.x0, a.x1), y: Math.min(a.y0, a.y1), w: Math.abs(a.x1 - a.x0), h: Math.abs(a.y1 - a.y0) };
		if (!pick) return;
		if (pick.kind === 'place') {
			const tile = pick.tile;
			const small = Math.hypot((a.x1 - a.x0) * 1.78, a.y1 - a.y0) < 1.6;
			const stage = tile.space === 'stage';
			const pt = (x: number, y: number) => (stage ? { x: round2(cam.view.x + (x * cam.view.w) / 100), y: round2(cam.view.y + (y * cam.view.h) / 100) } : { x, y });
			if (tile.placement === 'vector') {
				if (small) return void set({ status: 'Drag from the tail to the tip of the arrow' });
				const p0 = pt(a.x0, a.y0);
				const p1 = pt(a.x1, a.y1);
				void place(tile, { vector: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y } });
			} else if (small) {
				if (tile.placement === 'point') void place(tile, { point: pt(a.x0, a.y0) });
				else set({ status: 'Drag a box on the preview' });
			} else void place(tile, { region: stage ? toStage(r) : r });
			set({ pick: null });
			return;
		}
		if (r.w < 1.5 || r.h < 1.5) {
			set({ status: 'Drag a box on the preview' });
			return;
		}
		const st = toStage(r);
		const t = useStudio.getState().time;
		if (pick.kind === 'retarget') {
			void run([{ op: 'set_style', id: pick.id, to: st }]);
			set({ pick: null });
		} else if (pick.kind === 'focus') {
			// A zoom and an effect on the same spot, created together and linked: they move, copy, lock and delete as one.
			const g = `f${Date.now().toString(36).slice(-5)}`;
			const tile = EFFECT_TILES.find((x) => x.id === pick.effect)!;
			void run([
				{ op: 'add_zoom', at: t, until: t + 3, to: st, group: g, why: `focus: zoom + ${tile.label.toLowerCase()}` },
				{ ...placeOp(tile, { time: t, region: st }), group: g } as Op,
			]);
			set({ pick: null });
		} else if (pick.kind === 'zoom') {
			void run([{ op: 'add_zoom', at: t, until: t + 2.5, to: st, why: 'zoom you drew' }]);
			set({ pick: null });
		} else if (pick.kind === 'label') {
			setLabelFor(st);
			setLabelText('');
			set({ pick: null });
		} else {
			set({ region: st, pick: null, rightTab: 'assistant', status: 'Region attached to your next message' });
		}
	};

	useEffect(() => { force((n) => n + 1); }, [size.w, selection.join('|')]);
	// The handles must follow the graphic when its box changes (after a drag, an inspector edit, an undo, or the AI).
	const bx = layer?.box;
	useEffect(() => { requestAnimationFrame(() => moveable.current?.updateRect()); }, [bx?.x, bx?.y, bx?.w, bx?.h, size.w, size.h, one]);

	if (!edd) return <div className="preview-empty">Open a project to start.</div>;

	const lbox = layer?.box;
	return (
		<div className="preview">
			<div className="stage-wrap" ref={box}>
				<div className="stage" style={{ width: size.w, height: size.h }}>
					<Player
						ref={player}
						component={EddVideo}
						inputProps={{ edd, assetBase }}
						durationInFrames={totalFrames(edd)}
						fps={fps}
						compositionWidth={edd.format.width}
						compositionHeight={edd.format.height}
						style={{ width: size.w, height: size.h, background: '#000' }}
						acknowledgeRemotionLicense
						clickToPlay={false}
						doubleClickToFullscreen={false}
						spaceKeyToPlayOrPause={false}
						numberOfSharedAudioTags={40}
					/>
					<div
						ref={overlay}
						className={`overlay${pick ? ' picking' : ''}`}
						onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-cls-tile')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
						onDrop={(e) => {
							const raw = e.dataTransfer.getData('application/x-cls-tile');
							if (!raw) return;
							e.preventDefault();
							const tile = JSON.parse(raw) as Tile;
							const p = point(e as unknown as React.PointerEvent);
							const stage = tile.space === 'stage';
							const at = stage ? { x: round2(cam.view.x + (p.x * cam.view.w) / 100), y: round2(cam.view.y + (p.y * cam.view.h) / 100) } : p;
							void place(tile, { point: at, ...(tile.placement === 'vector' ? { vector: { x0: at.x - 8, y0: at.y, x1: at.x + 8, y1: at.y } } : {}) });
						}}
						onPointerDown={(e) => {
							if (!pick) return;
							const p = point(e);
							(e.target as HTMLElement).setPointerCapture(e.pointerId);
							setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
						}}
						onPointerMove={(e) => { if (drag) { const p = point(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
						onPointerUp={(e) => { if (drag) { const p = point(e); finishPick({ ...drag, x1: p.x, y1: p.y }); setDrag(null); } }}
					>
						{guides ? (
							<>
								<div className="guide safe" />
								<div className="guide v" style={{ left: '50%' }} />
								<div className="guide h" style={{ top: '50%' }} />
								<div className="guide v" style={{ left: '33.33%' }} /><div className="guide v" style={{ left: '66.66%' }} />
								<div className="guide h" style={{ top: '33.33%' }} /><div className="guide h" style={{ top: '66.66%' }} />
							</>
						) : null}
						{layer && lbox && !drag && !pick ? (
							<div ref={target} className={`handle${handlesOn ? '' : ' idle'}`} style={{ left: pct(lbox.x), top: pct(lbox.y), width: pct(lbox.w), height: pct(lbox.h) }} />
						) : null}
						{drag && pick?.kind === 'place' && pick.tile.placement === 'vector' ? (
							<svg className="vecline" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={drag.x0} y1={drag.y0} x2={drag.x1} y2={drag.y1} vectorEffect="non-scaling-stroke" /></svg>
						) : drag ? <div className="pickbox" style={{ left: pct(Math.min(drag.x0, drag.x1)), top: pct(Math.min(drag.y0, drag.y1)), width: pct(Math.abs(drag.x1 - drag.x0)), height: pct(Math.abs(drag.y1 - drag.y0)) }} /> : null}
						{pick ? <div className="pickhint"><Crosshair size={14} /> {pick.kind === 'place' ? (pick.tile.placement === 'vector' ? `Drag the arrow: tail to tip (${pick.tile.label})` : pick.tile.placement === 'point' ? `Click where to put ${pick.tile.label} (or drag a box)` : `Drag a box for ${pick.tile.label}`) : `Drag a box for the ${pick.kind === 'zoom' || pick.kind === 'retarget' || pick.kind === 'focus' ? 'zoom' : pick.kind === 'label' ? 'label target' : 'area'}`} (Esc to cancel){cam.scale > 1.001 ? ' · the view is zoomed, coordinates follow it' : ''}</div> : null}
						{labelFor ? (
							<form className="labelpop" style={{ left: pct(Math.min(70, labelFor.x)), top: pct(Math.min(85, labelFor.y + labelFor.h + 1)) }} onSubmit={(e) => {
								e.preventDefault();
								const t = useStudio.getState().time;
								if (labelText.trim()) void run([{ op: 'add_layer', component: 'UILabel', at: t, until: t + 2.6, props: { text: labelText.trim(), target: labelFor }, box: { x: Math.min(80, labelFor.x), y: Math.min(90, labelFor.y + labelFor.h + 1.5), w: Math.min(40, Math.max(14, labelText.length * 1.35 + 6)), h: 6 }, why: 'label you drew' }]);
								setLabelFor(null);
							}}>
								<input autoFocus value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Label text, Enter" onKeyDown={(e) => { if (e.key === 'Escape') setLabelFor(null); }} />
							</form>
						) : null}
						{labelFor ? <div className="pickbox done" style={{ left: pct(labelFor.x), top: pct(labelFor.y), width: pct(labelFor.w), height: pct(labelFor.h) }} /> : null}
					</div>
					{handlesOn && target.current ? (
						<Moveable
							ref={moveable}
							target={target.current}
							container={overlay.current}
							draggable
							resizable
							keepRatio={KEEP_RATIO.has(layer!.component)}
							throttleDrag={0}
							snappable
							snapDirections={{ left: true, top: true, right: true, bottom: true, center: true, middle: true }}
							snapThreshold={6}
							horizontalGuidelines={[0, size.h * 0.05, size.h / 2, size.h * 0.95, size.h]}
							verticalGuidelines={[0, size.w * 0.05, size.w / 2, size.w * 0.95, size.w]}
							renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
							onDrag={(e) => { e.target.style.transform = e.transform; }}
							onDragEnd={(e) => { if (e.isDrag) commitBox(); }}
							onResize={(e) => {
								e.target.style.width = `${e.width}px`;
								e.target.style.height = `${e.height}px`;
								e.target.style.transform = e.drag.transform;
							}}
							onResizeEnd={(e) => { if (e.isDrag) commitBox(); }}
						/>
					) : null}
					{draft ? (
						<div className="draftbar">
							<span>Draft: {draft.label.slice(0, 48)}. Not saved yet.</span>
							<button className="primary" onClick={() => void accept()}>Apply</button>
							<button onClick={() => discard()}>Discard</button>
						</div>
					) : null}
				</div>
			</div>
			<div className="transport">
				<button onClick={() => step(-1)} title="Back one frame (←)"><ChevronLeft size={16} /></button>
				<button className="primary round" onClick={toggle} title="Play / pause (Space)">{playing ? <Pause size={16} /> : <Play size={16} />}</button>
				<button onClick={() => step(1)} title="Forward one frame (→)"><ChevronRight size={16} /></button>
				<span className="timecode">{fmt(time)} / {fmt(edd.beats[edd.beats.length - 1].end)}</span>
				<span className="spacer" />
				{layer && !handlesOn && live && isStage && cam.scale > 1.001 ? <span className="hint">Camera is zoomed: move the playhead out of the zoom to drag this label</span> : null}
				<button className={guides ? 'on' : ''} onClick={() => set({ guides: !guides })} title="Safe area and thirds"><Frame size={16} /> Guides</button>
				<button onClick={() => setMuted(!muted)} title="Mute preview">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
			</div>
		</div>
	);
};
