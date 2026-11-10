import { FilePlus, Film, FolderOpen, Image as ImageIcon, Music, Play, Search, Settings2, Square, Trash2, Upload } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../api';
import { api } from '../api';
import { useStudio } from '../store';
import { tileClick } from './Library';
import type { Tile } from './tiles';

const ACCEPT = '.mp4,.mov,.mkv,.webm,.avi,.m4v,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.mp3,.wav,.m4a,.aac,.ogg,.flac';
const dur = (s: number | null) => (s === null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);

/** How a bin item becomes a draggable / clickable tile (the same placement machinery as every other tile). */
const tileFor = (m: MediaItem): Tile | null => {
	if (m.kind === 'image') return { id: `media-${m.name}`, label: m.name, hint: 'Image', placement: 'region', component: 'PopImage', props: { src: m.path, fit: 'contain' }, len: 3.5, size: { w: 30, h: 30 } };
	if (m.kind === 'video') return { id: `media-${m.name}`, label: m.name, hint: 'Video clip on top of the picture', placement: 'region', component: 'VideoClip', props: { src: m.path, from: 0, fit: 'cover' }, len: Math.min(m.duration ?? 4, 12), size: { w: 34, h: 34 } };
	return null;
};

let preview: HTMLAudioElement | null = null;

const Card: React.FC<{ m: MediaItem; used: boolean }> = ({ m, used }) => {
	const base = useStudio((s) => s.assetBase);
	const dir = useStudio((s) => s.dir);
	const run = useStudio((s) => s.run);
	const set = useStudio((s) => s.set);
	const loadMedia = useStudio((s) => s.loadMedia);
	const [playing, setPlaying] = useState(false);
	const now = () => useStudio.getState().time;
	const tile = tileFor(m);
	const toTimeline = () => void run([{ op: 'add_footage', src: m.path, duration: m.duration ?? 5, kind: m.kind === 'image' ? 'image' : 'video', has_audio: m.hasAudio }], `added ${m.name} to the timeline`);
	const play = () => {
		if (playing) { preview?.pause(); setPlaying(false); return; }
		preview?.pause();
		preview = new Audio(`${base}${m.path}`);
		preview.onended = () => setPlaying(false);
		void preview.play();
		setPlaying(true);
	};
	const remove = async () => {
		if (!dir || !window.confirm(`Delete ${m.name} from this project's media?`)) return;
		try { await api.deleteMedia(dir, m.name); await loadMedia(); } catch (e) { set({ status: e instanceof Error ? e.message : String(e) }); }
	};
	return (
		<div className="mcard" draggable={!!tile} onDragStart={(e) => { if (!tile) return; e.dataTransfer.setData('application/x-cls-tile', JSON.stringify(tile)); e.dataTransfer.effectAllowed = 'copy'; }} title={`${m.name}\n${mb(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}${m.fps ? ` · ${m.fps} fps` : ''}${tile ? '\nDrag onto the preview to place it.' : ''}`}>
			<div className="mthumb">
				{m.thumb ? <img src={`${base}${m.thumb}`} alt="" draggable={false} /> : <div className="mnothumb">{m.kind === 'audio' ? <Music size={26} /> : <Film size={26} />}</div>}
				{m.kind === 'audio' ? <button className="mplay" onClick={play} title="Listen">{playing ? <Square size={13} /> : <Play size={13} />}</button> : null}
				{m.duration !== null ? <span className="mdur">{dur(m.duration)}</span> : null}
				{used ? <span className="mused" title="Used in the edit">in use</span> : null}
				<button className="mdel" onClick={() => void remove()} title="Delete from the project"><Trash2 size={12} /></button>
			</div>
			<b className="mname">{m.name}</b>
			<small>{m.kind === 'audio' ? 'Audio' : m.kind === 'image' ? 'Image' : 'Video'}{m.width ? ` · ${m.width}×${m.height}` : ''}</small>
			<div className="mactions">
				{m.kind === 'audio' ? (
					<>
						<button onClick={() => void run([{ op: 'add_sfx', src: m.path, at: now(), volume: 0.6, role: 'media' }], `added ${m.name} at the playhead`)}>Sound here</button>
						<button onClick={() => void run([{ op: 'set_voice', src: m.path }], `${m.name} is the main audio`)}>Main audio</button>
					</>
				) : (
					<>
						<button className="primary" onClick={toTimeline} title="Append to the end of the sequence">+ Timeline</button>
						{tile ? <button onClick={() => tileClick(tile)} title="Then draw its area on the preview">Overlay</button> : null}
					</>
				)}
			</div>
		</div>
	);
};

export const MediaTab: React.FC = () => {
	const dir = useStudio((s) => s.dir);
	const edd = useStudio((s) => s.edd);
	const media = useStudio((s) => s.media);
	const uploads = useStudio((s) => s.uploads);
	const uploadFiles = useStudio((s) => s.uploadFiles);
	const set = useStudio((s) => s.set);
	const [kind, setKind] = useState<'all' | MediaItem['kind']>('all');
	const [q, setQ] = useState('');
	const [over, setOver] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const edit = useMemo(() => (edd ? JSON.stringify(edd) : ''), [edd]);
	const shown = media.filter((m) => (kind === 'all' || m.kind === kind) && m.name.toLowerCase().includes(q.trim().toLowerCase()));

	if (!dir || !edd) {
		return (
			<div className="mediatab empty">
				<div className="group">Media</div>
				<p className="note">Open a project, or start one: pick the size and frame rate, then bring in your footage.</p>
				<button className="primary wide" onClick={() => set({ dialog: 'new-project' })}><FilePlus size={15} /> New project</button>
			</div>
		);
	}
	const f = edd.format;
	const projectName = dir.split(/[\\/]/).pop();
	return (
		<div className="mediatab">
			<div className="group">Project</div>
			<div className="projcard">
				<div className="projname" title={dir}><FolderOpen size={14} /> <b>{projectName}</b></div>
				<small>{f.width}×{f.height} · {f.fps} fps · {edd.beats[edd.beats.length - 1].end.toFixed(1)} s</small>
				<div className="projbtns">
					<button onClick={() => set({ dialog: 'project-settings' })} title="Sequence size and frame rate"><Settings2 size={14} /> Settings</button>
					<button onClick={() => set({ dialog: 'new-project' })}><FilePlus size={14} /> New</button>
				</div>
			</div>

			<div className="group">Media</div>
			<div
				className={`dropzone${over ? ' over' : ''}`}
				onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => { e.preventDefault(); setOver(false); void uploadFiles(Array.from(e.dataTransfer.files)); }}
				onClick={() => input.current?.click()}
			>
				<Upload size={20} />
				<b>Drop videos, images or audio here</b>
				<small>or click to import. Files are copied into the project.</small>
				<input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
			</div>
			{uploads.map((u) => (
				<div key={u.id} className={`upload${u.error ? ' bad' : ''}`}>
					<span>{u.name}</span>
					{u.error ? <><em>{u.error}</em><button onClick={() => useStudio.setState((s) => ({ uploads: s.uploads.filter((x) => x.id !== u.id) }))}>Dismiss</button></> : <progress value={u.pct} max={100} />}
				</div>
			))}

			<div className="filters">
				<div className="chips">
					{(['all', 'video', 'image', 'audio'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'video' ? 'Video' : k === 'image' ? 'Images' : 'Audio'}</button>)}
				</div>
				<label className="msearch"><Search size={12} /><input placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} /></label>
			</div>
			{!media.length ? <p className="note"><ImageIcon size={13} /> Nothing here yet. Import footage, then press <b>+ Timeline</b> to add it to the sequence.</p> : null}
			<div className="mgrid">{shown.map((m) => <Card key={m.name} m={m} used={edit.includes(`"${m.path}"`)} />)}</div>
		</div>
	);
};
