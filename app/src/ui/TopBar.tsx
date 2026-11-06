import { Clapperboard, ExternalLink, RotateCcw, RotateCw, Sparkles, Wand2 } from 'lucide-react';
import React from 'react';
import { stats } from './stats';
import { useStudio } from '../store';

export const TopBar: React.FC = () => {
	const projects = useStudio((s) => s.projects);
	const dir = useStudio((s) => s.dir);
	const edd = useStudio((s) => s.edd);
	const canUndo = useStudio((s) => s.canUndo);
	const canRedo = useStudio((s) => s.canRedo);
	const busy = useStudio((s) => s.busy);
	const log = useStudio((s) => s.log);
	const out = useStudio((s) => s.renderOutput);
	const base = useStudio((s) => s.assetBase);
	const open = useStudio((s) => s.open);
	const undo = useStudio((s) => s.undo);
	const redo = useStudio((s) => s.redo);
	const render = useStudio((s) => s.render);
	const replan = useStudio((s) => s.replan);
	const set = useStudio((s) => s.set);
	const st = edd ? stats(edd) : null;
	const file = out ? out.replace(/\\/g, '/').split('/renders/')[1] : null;
	const lastLog = log.trim().split('\n').slice(-1)[0]?.slice(0, 90);
	return (
		<header className="topbar">
			<span className="brand"><Clapperboard size={18} /> Chumps Lab Studio</span>
			<select className="project-select" value={dir ?? ''} onChange={(e) => e.target.value && void open(e.target.value)}>
				<option value="">Open project…</option>
				{projects.filter((p) => !p.name.startsWith('_')).map((p) => <option key={p.dir} value={p.dir}>{p.name}</option>)}
			</select>
			{st ? <span className="meta">{st.layers} graphics · {st.camera} zooms · {st.sfx} sounds · {st.user} by you · {st.locked} locked</span> : null}
			<span className="spacer" />
			<button disabled={!canUndo} onClick={() => void undo()} title="Undo (Ctrl+Z)"><RotateCcw size={15} /> Undo</button>
			<button disabled={!canRedo} onClick={() => void redo()} title="Redo (Ctrl+Shift+Z)"><RotateCw size={15} /> Redo</button>
			<button onClick={() => set({ rightTab: 'assistant' })} title="Ask the assistant (/)"><Sparkles size={15} /> Assistant</button>
			<button disabled={!dir || !!busy} onClick={() => void replan()} title="Run the AI planner again. Items you edited or locked are kept."><Wand2 size={15} /> {busy === 'replan' ? 'Re-planning…' : 'AI re-plan'}</button>
			<button className="primary" disabled={!dir || !!busy} onClick={() => void render()}>{busy === 'render' ? 'Rendering…' : 'Render'}</button>
			{busy && lastLog ? <span className="joblog" title={log}>{lastLog}</span> : null}
			{file && !busy ? <a className="outlink" href={`${base}renders/${file}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open render</a> : null}
		</header>
	);
};
