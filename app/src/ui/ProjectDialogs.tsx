import { FilePlus, Settings2, X } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useStudio } from '../store';
import { SEQUENCE_PRESETS, presetFor } from './sequencePresets';

/** Width / height / frame-rate picker shared by New Project and Project Settings (presets plus a custom entry, as in Premiere). */
const SequencePicker: React.FC<{ value: { width: number; height: number; fps: number }; onChange: (v: { width: number; height: number; fps: number }) => void }> = ({ value, onChange }) => {
	const id = presetFor(value.width, value.height, value.fps);
	const num = (k: 'width' | 'height' | 'fps', lo: number, hi: number) => (
		<label className="num"><span>{k === 'fps' ? 'Frame rate' : k === 'width' ? 'Width' : 'Height'}</span>
			<input type="number" min={lo} max={hi} value={value[k]} onChange={(e) => onChange({ ...value, [k]: Math.min(hi, Math.max(lo, Math.round(Number(e.target.value) || lo))) })} />
		</label>
	);
	return (
		<>
			<label className="sel"><span>Sequence preset</span>
				<select value={id} onChange={(e) => { const p = SEQUENCE_PRESETS.find((x) => x.id === e.target.value); if (p) onChange({ width: p.width, height: p.height, fps: p.fps }); }}>
					{SEQUENCE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
					{id === 'custom' ? <option value="custom">Custom</option> : null}
				</select>
			</label>
			<div className="row3">{num('width', 16, 7680)}{num('height', 16, 4320)}{num('fps', 1, 120)}</div>
		</>
	);
};

const NewProject: React.FC = () => {
	const set = useStudio((s) => s.set);
	const create = useStudio((s) => s.createProject);
	const [name, setName] = useState('Untitled project');
	const [fmt, setFmt] = useState({ width: 1920, height: 1080, fps: 30 });
	const [files, setFiles] = useState<File[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const pick = useRef<HTMLInputElement>(null);
	const go = async () => {
		setBusy(true);
		setError('');
		try { await create({ name, ...fmt }, files); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
	};
	return (
		<div className="dialog" onClick={(e) => e.stopPropagation()}>
			<div className="dialog-head"><FilePlus size={16} /> <b>New project</b><button className="icon" onClick={() => set({ dialog: null })} title="Close (Esc)"><X size={14} /></button></div>
			<label className="txt"><span>Project name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void go(); }} /></label>
			<SequencePicker value={fmt} onChange={setFmt} />
			<div className="field">
				<span>Starting footage <small>(optional: it is copied into the project and placed on the timeline)</small></span>
				<button onClick={() => pick.current?.click()}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen` : 'Choose files…'}</button>
				<input ref={pick} type="file" multiple hidden accept=".mp4,.mov,.mkv,.webm,.avi,.m4v,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
				{files.length ? <ul className="filelist">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul> : null}
			</div>
			{error ? <p className="err">{error}</p> : null}
			<div className="dialog-foot">
				<button onClick={() => set({ dialog: null })}>Cancel</button>
				<button className="primary" disabled={busy || !name.trim()} onClick={() => void go()}>{busy ? 'Creating…' : 'Create project'}</button>
			</div>
		</div>
	);
};

const ProjectSettings: React.FC = () => {
	const set = useStudio((s) => s.set);
	const run = useStudio((s) => s.run);
	const edd = useStudio((s) => s.edd);
	const dir = useStudio((s) => s.dir);
	const [fmt, setFmt] = useState(edd?.format ?? { width: 1920, height: 1080, fps: 30 });
	if (!edd) return null;
	const same = fmt.width === edd.format.width && fmt.height === edd.format.height && fmt.fps === edd.format.fps;
	return (
		<div className="dialog" onClick={(e) => e.stopPropagation()}>
			<div className="dialog-head"><Settings2 size={16} /> <b>Project settings</b><button className="icon" onClick={() => set({ dialog: null })} title="Close (Esc)"><X size={14} /></button></div>
			<p className="note" title={dir ?? ''}>{dir}</p>
			<SequencePicker value={fmt} onChange={setFmt} />
			<p className="note">Changing the size or frame rate affects the next render and the preview. Graphics are placed in percentages, so they stay where they are; footage is fitted to the new frame.</p>
			<div className="dialog-foot">
				<button onClick={() => set({ dialog: null })}>Close</button>
				<button className="primary" disabled={same} onClick={() => { void run([{ op: 'set_format', ...fmt }], 'sequence settings changed'); set({ dialog: null }); }}>Apply</button>
			</div>
		</div>
	);
};

export const Dialogs: React.FC = () => {
	const dialog = useStudio((s) => s.dialog);
	const set = useStudio((s) => s.set);
	if (!dialog) return null;
	return <div className="help-backdrop" onClick={() => set({ dialog: null })}>{dialog === 'new-project' ? <NewProject /> : <ProjectSettings />}</div>;
};
