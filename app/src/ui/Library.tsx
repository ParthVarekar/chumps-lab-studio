import { Captions, Crosshair, Layers, Music, Plus, Search, Shapes, Sparkles, Smile, Subtitles, Wand2, Zap, Play, Square, Save, MousePointer2 } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SfxItem, type Sticker } from '../api';
import { useStudio, type Tab } from '../store';
import { ElementThumb } from './ElementThumb';
import { ADD_TILES, CAPTION_STYLES, EFFECT_TILES, TRANSITION_TILES, elementTile, type Tile } from './tiles';

const SECTIONS: { id: Tab; label: string; icon: React.ReactNode }[] = [
	{ id: 'add', label: 'Add', icon: <Plus size={18} /> },
	{ id: 'effects', label: 'Effects', icon: <Layers size={18} /> },
	{ id: 'transitions', label: 'Transitions', icon: <Zap size={18} /> },
	{ id: 'captions', label: 'Captions', icon: <Subtitles size={18} /> },
	{ id: 'elements', label: 'Elements', icon: <Shapes size={18} /> },
	{ id: 'logos', label: 'Logos', icon: <Search size={18} /> },
	{ id: 'stickers', label: 'Stickers', icon: <Smile size={18} /> },
	{ id: 'sounds', label: 'Sounds', icon: <Music size={18} /> },
	{ id: 'transcript', label: 'Script', icon: <Captions size={18} /> },
];

const lib = { sfx: [] as SfxItem[], stickers: [] as Sticker[], loaded: false };
const now = () => useStudio.getState().time;

export const Library: React.FC = () => {
	const tab = useStudio((s) => s.leftTab);
	const set = useStudio((s) => s.set);
	const [, force] = useState(0);
	useEffect(() => {
		if (lib.loaded) return;
		void api.library().then((l) => { lib.sfx = l.sfx; lib.stickers = l.memes.memes; lib.loaded = true; force((n) => n + 1); });
	}, []);
	return (
		<div className="library">
			<nav className="rail">
				{SECTIONS.map((t) => (
					<button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => set({ leftTab: t.id })} title={t.label}>{t.icon}<span>{t.label}</span></button>
				))}
			</nav>
			<div className="tabbody">
				{tab === 'add' ? <TileGrid title="Text and graphics" tiles={ADD_TILES} hint="Click to add at the playhead, or drag onto the preview." />
					: tab === 'effects' ? <TileGrid title="Effects" tiles={EFFECT_TILES} hint="Click a tile, then drag a box on the preview. Or drag the tile straight onto the picture." extra={<ZoomLabelTiles />} />
					: tab === 'transitions' ? <TileGrid title="Transitions and moments" tiles={TRANSITION_TILES} hint="One click: it is centred on the playhead, so put the playhead on the cut first." extra={<MoodTiles />} />
					: tab === 'captions' ? <CaptionsTab />
					: tab === 'elements' ? <ElementsTab />
					: tab === 'logos' ? <LogosTab />
					: tab === 'stickers' ? <StickersTab />
					: tab === 'sounds' ? <SoundsTab />
					: <ScriptTab />}
			</div>
		</div>
	);
};

// ------------------------------------------------------------------ tiles you can click, draw or drag
export const tileClick = (t: Tile) => {
	const st = useStudio.getState();
	if (t.placement === 'moment') return void st.place(t, {});
	st.set({ pick: { kind: 'place', tile: t }, status: t.placement === 'vector' ? 'Drag from the tail to the tip of the arrow' : t.placement === 'point' ? 'Click where it should go (or drag a box)' : 'Drag a box on the preview' });
};

const TileButton: React.FC<{ t: Tile; thumb?: React.ReactNode }> = ({ t, thumb }) => (
	<button
		className="tile"
		draggable
		onDragStart={(e) => { e.dataTransfer.setData('application/x-cls-tile', JSON.stringify(t)); e.dataTransfer.effectAllowed = 'copy'; }}
		onClick={() => tileClick(t)}
		title={`${t.hint}. ${t.placement === 'moment' ? 'One click.' : 'Click, then draw on the preview, or drag me onto it.'}`}
	>
		{thumb}
		<b>{t.label}</b>
		<small>{t.hint}</small>
	</button>
);

const TileGrid: React.FC<{ title: string; tiles: Tile[]; hint: string; extra?: React.ReactNode }> = ({ title, tiles, hint, extra }) => (
	<div>
		<div className="group">{title}</div>
		<p className="note">{hint}</p>
		<div className="grid2">{tiles.map((t) => <TileButton key={t.id} t={t} />)}</div>
		{extra}
	</div>
);

const ZoomLabelTiles: React.FC = () => {
	const set = useStudio((s) => s.set);
	return (
		<>
			<div className="group">Camera and labels</div>
			<div className="grid2">
				<button className="tile" onClick={() => set({ pick: { kind: 'zoom' }, status: 'Drag a box to zoom into' })}><Crosshair size={16} /><b>Zoom</b><small>Drag the region to zoom into</small></button>
				<button className="tile" onClick={() => set({ pick: { kind: 'focus', effect: 'spotlight' }, status: 'Drag a box: it zooms in and the rest dims (linked)' })}><Crosshair size={16} /><b>Zoom + spotlight</b><small>One box: zoom in, dim the rest. Linked</small></button>
				<button className="tile" onClick={() => set({ pick: { kind: 'focus', effect: 'hl-box' }, status: 'Drag a box: it zooms in and gets outlined (linked)' })}><Crosshair size={16} /><b>Zoom + highlight</b><small>One box: zoom in and outline it. Linked</small></button>
				<button className="tile" onClick={() => set({ pick: { kind: 'label' }, status: 'Drag a box around the thing to label' })}><Crosshair size={16} /><b>Label</b><small>Drag around a UI element, type the text</small></button>
			</div>
		</>
	);
};

const MoodTiles: React.FC = () => {
	const run = useStudio((s) => s.run);
	return (
		<>
			<div className="group">Mood</div>
			<div className="grid2">
				{(['shock', 'anger', 'sad', 'happy', 'confusion'] as const).map((k) => (
					<button key={k} className="tile" onClick={() => void run([{ op: 'add_mood', kind: k, at: now(), duration: 1.2 }])}><Smile size={16} /><b>{k[0].toUpperCase() + k.slice(1)}</b><small>1.2 s at the playhead</small></button>
				))}
			</div>
		</>
	);
};

// ------------------------------------------------------------------ captions
const CaptionsTab: React.FC = () => {
	const add = useStudio((s) => s.addCaptions);
	const words = useStudio((s) => s.words);
	const [range, setRange] = useState<'all' | 'here' | 'next10'>('all');
	return (
		<div>
			<div className="group">Captions from the transcript</div>
			<p className="note">{words.length} words with timing. Pick a style: it is added over the range below and you can restyle it in the inspector.</p>
			<div className="chips">
				{([['all', 'Whole video'], ['here', 'From playhead'], ['next10', 'Next 10 s']] as const).map(([k, l]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}
			</div>
			<div className="grid1">
				{CAPTION_STYLES.map((c) => (
					<button key={c.id} className="tile wide" onClick={() => void add(c.props, range)}><Subtitles size={16} /><b>{c.label}</b><small>{c.hint}</small></button>
				))}
			</div>
		</div>
	);
};

// ------------------------------------------------------------------ elements: gallery + AI designer
/** What each chip adds in front of the brief. These words also steer which preset the designer shows the model as an example. */
const KIND_HINT = {
	auto: '',
	'2d': 'Keep it a flat 2D graphic. ',
	'3d': 'Make it a 3D scene (scene3d: solids with an orbiting camera). ',
	explainer: 'Make it an explainer: the parts appear one after another (appear), each labelled, with arrows that draw between them. ',
} as const;

const ElementsTab: React.FC = () => {
	const elements = useStudio((s) => s.elements);
	const region = useStudio((s) => s.region);
	const time = useStudio((s) => s.time);
	const designing = useStudio((s) => s.designing);
	const design = useStudio((s) => s.design);
	const set = useStudio((s) => s.set);
	const [brief, setBrief] = useState('');
	const [kind, setKind] = useState<'auto' | '2d' | '3d' | 'explainer'>('auto');
	const [secs, setSecs] = useState(3.5);
	const [q, setQ] = useState('');
	const shown = useMemo(() => elements.filter((e) => !q || `${e.name} ${e.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [elements, q]);
	return (
		<div>
			<div className="group">Design with AI</div>
			<div className="designer">
				<textarea rows={3} value={brief} placeholder="Describe what you need: “a small animated speedometer showing 78% CPU”, “a waving plant”, “a pulsing wifi signal”…" onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void design(brief, secs); }} />
				<div className="chips" title="Steers the designer: a flat graphic, a 3D scene, or an explainer that reveals its parts one by one">
					{(['auto', '2d', '3d', 'explainer'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'auto' ? 'Auto' : k === 'explainer' ? 'Explainer' : k.toUpperCase()}</button>)}
				</div>
				<div className="designrow">
					<button className={region ? 'on' : ''} onClick={() => set({ pick: { kind: 'region' }, status: 'Drag a box where the element should go' })}><Crosshair size={14} /> {region ? `Area set (${Math.round(region.w)}×${Math.round(region.h)}%)` : 'Draw its area'}</button>
					<span className="chip">starts {time.toFixed(1)} s</span>
					<label className="inline">for <input type="number" min={1} max={20} step={0.5} value={secs} onChange={(e) => setSecs(Number(e.target.value) || 3)} /> s</label>
				</div>
				<button className="primary wide" disabled={!brief.trim() || !!designing} onClick={() => void design(`${KIND_HINT[kind]}${brief}`, secs)}><Wand2 size={15} /> {designing ? 'Designing…' : 'Design it'}</button>
				<p className="note">It reads the colours under your area, the text nearby and what is being said, then gives the element its own settings. You see it as a draft before it is added; refine it in plain words afterwards.</p>
			</div>
			<div className="group">Ready-made and saved</div>
			<input className="search" placeholder="Search: gauge, wifi, plant, loading…" value={q} onChange={(e) => setQ(e.target.value)} />
			<div className="grid2">
				{shown.map((e) => {
					const t = elementTile(e.name, e.spec, e.params);
					return (
						<button key={e.id} className="tile elem" draggable onDragStart={(ev) => { ev.dataTransfer.setData('application/x-cls-tile', JSON.stringify(t)); ev.dataTransfer.effectAllowed = 'copy'; }} onClick={() => tileClick(t)} title={`${e.description}\nClick, then draw its area on the preview. Or drag it onto the picture. Hover to see it move.`}>
							<ElementThumb spec={e.spec} params={e.params} />
							<b>{e.name}{e.saved ? ' ★' : ''}</b>
							<small>{e.spec.params.length} setting{e.spec.params.length === 1 ? '' : 's'}</small>
						</button>
					);
				})}
			</div>
		</div>
	);
};

// ------------------------------------------------------------------ logos, stickers, sounds, script
const LogosTab: React.FC = () => {
	const dir = useStudio((s) => s.dir);
	const [q, setQ] = useState('');
	const [res, setRes] = useState<{ id: string; svg: string }[]>([]);
	useEffect(() => {
		const t = setTimeout(() => void api.icons(q).then(setRes).catch(() => setRes([])), 180);
		return () => clearTimeout(t);
	}, [q]);
	return (
		<div>
			<div className="group">Logos</div>
			<input className="search" placeholder="Search 3,000 logos: python, vscode, linux…" value={q} onChange={(e) => setQ(e.target.value)} />
			<div className="thumbs">
				{res.map((r) => (
					<button key={r.id} className="thumb" title={`${r.id}: add at playhead`} onClick={async () => {
						if (!dir) return;
						const x = await api.addFromLibrary(dir, 'icon', r.id, now());
						if (x.id) useStudio.getState().set({ selection: [x.id], status: `Added ${r.id} logo` });
					}}>
						<span dangerouslySetInnerHTML={{ __html: r.svg }} />
						<small>{r.id}</small>
					</button>
				))}
			</div>
			<p className="note">Simple Icons, CC0. White single-colour marks.</p>
		</div>
	);
};

const StickersTab: React.FC = () => {
	const dir = useStudio((s) => s.dir);
	const [q, setQ] = useState('');
	const list = useMemo(() => lib.stickers.filter((s) => !q || (s.id + ' ' + s.tags.join(' ')).includes(q.toLowerCase())), [q, lib.loaded]);
	return (
		<div>
			<div className="group">Animated stickers</div>
			<input className="search" placeholder="Search: skull, cry, fire, clown…" value={q} onChange={(e) => setQ(e.target.value)} />
			<div className="thumbs">
				{list.map((m) => (
					<button key={m.id} className="thumb" title={`${m.id}: add at playhead`} onClick={async () => {
						if (!dir) return;
						const x = await api.addFromLibrary(dir, 'sticker', m.id, now());
						if (x.id) useStudio.getState().set({ selection: [x.id], status: `Added ${m.id} sticker` });
					}}>
						<img src={`/library/memes/${m.file}`} alt={m.id} loading="lazy" />
						<small>{m.id}</small>
					</button>
				))}
			</div>
			<p className="note">Animated Noto Emoji by Google Fonts, CC BY 4.0: credit in the video description (see the library's CREDITS.md).</p>
		</div>
	);
};

const SoundsTab: React.FC = () => {
	const dir = useStudio((s) => s.dir);
	const [role, setRole] = useState('whoosh');
	const [playing, setPlaying] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);
	const roles = useMemo(() => Array.from(new Set(lib.sfx.map((s) => s.role))), [lib.loaded]);
	const list = lib.sfx.filter((s) => s.role === role);
	const play = (s: SfxItem) => {
		audio.current?.pause();
		const a = new Audio(`/library/sfx/${s.file}`);
		audio.current = a;
		setPlaying(s.id);
		a.onended = () => setPlaying(null);
		void a.play();
	};
	return (
		<div>
			<div className="group">Sound effects</div>
			<div className="chips">
				{roles.map((r) => <button key={r} className={r === role ? 'on' : ''} onClick={() => setRole(r)}>{r.replace('_', ' ')}</button>)}
			</div>
			<div className="rows">
				{list.map((s) => (
					<div key={s.id} className="row">
						<button className="icon" onClick={() => play(s)} title="Audition">{playing === s.id ? <Square size={13} /> : <Play size={13} />}</button>
						<span className="grow">{s.id.split('-').slice(2).join('-') || s.role}<small> {s.duration.toFixed(2)} s</small></span>
						<button className="mini" onClick={async () => {
							if (!dir) return;
							const x = await api.addFromLibrary(dir, 'sfx', s.id, now());
							if (x.id) useStudio.getState().set({ selection: [x.id], status: `Added ${s.role} sound` });
						}}>Add</button>
					</div>
				))}
			</div>
			<p className="note">CC0 sounds (Kenney, qubodup and others from OpenGameArt). Adds at the playhead.</p>
		</div>
	);
};

const ScriptTab: React.FC = () => {
	const words = useStudio((s) => s.words);
	const time = useStudio((s) => s.time);
	const seek = useStudio((s) => s.seekTo);
	const run = useStudio((s) => s.run);
	const [selected, setSelected] = useState<number | null>(null);
	const cur = useRef<HTMLSpanElement>(null);
	const idx = useMemo(() => {
		let lo = 0, hi = words.length - 1, best = -1;
		while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m].start <= time) { best = m; lo = m + 1; } else hi = m - 1; }
		return best;
	}, [words, time]);
	useEffect(() => { cur.current?.scrollIntoView({ block: 'nearest' }); }, [idx]);
	const w = selected !== null ? words[selected] : null;
	return (
		<div className="script">
			<div className="group">Script</div>
			<div className="words">
				{words.map((x, i) => (
					<span key={i} ref={i === idx ? cur : undefined} className={`w${i === idx ? ' now' : ''}${i === selected ? ' sel' : ''}`} title={`${x.start.toFixed(2)} s`} onClick={() => { setSelected(i); seek(Math.max(0, x.start)); }}>{x.text} </span>
				))}
			</div>
			<div className="scriptbar">
				{w ? (
					<>
						<span className="grow">“{w.text.replace(/[.,!?]$/, '')}” at {w.start.toFixed(1)} s</span>
						<button className="mini" onClick={() => void run([{ op: 'add_layer', component: 'KineticWord', at: Math.max(0, w.start - 0.5), props: { text: w.text.replace(/[.,!?]$/, '').toUpperCase() }, why: `big word on “${w.text}”` }])}>Big word</button>
						<button className="mini" onClick={() => void run([{ op: 'add_layer', component: 'Title', at: Math.max(0, w.start - 0.5), props: { text: w.text.replace(/[.,!?]$/, '') }, why: `title on “${w.text}”` }])}>Title</button>
					</>
				) : <span className="note">Click a word to jump there; then add a big word or title on it (placed 0.5 s early, like the AI does).</span>}
			</div>
		</div>
	);
};

void Sparkles; void Save; void MousePointer2;
