import { AlertTriangle, Wand2 } from 'lucide-react';
import React from 'react';
import { fmt, useStudio } from '../store';

/** The checks the pipeline already runs (geometry + the AI frame review), as a to-do list you can click through. */
export const Review: React.FC = () => {
	const report = useStudio((s) => s.report);
	const seek = useStudio((s) => s.seekTo);
	const select = useStudio((s) => s.select);
	const ask = useStudio((s) => s.ask);
	if (!report) return <div className="review empty"><p>No review notes for this project yet. They appear after a full pipeline run with the AI frame review.</p></div>;
	const geo: { type: string; t: number; layers: string[]; severity: number }[] = report.geometry?.issues ?? [];
	const vl: { severity: number; t: number | null; element: string; observation: string; suggestion: string; type: string }[] = report.vl_issues ?? report.vl_review?.issues ?? [];
	const items = [
		...geo.map((g) => ({ key: `g${g.type}${g.t}${g.layers.join()}`, sev: g.severity, t: g.t, title: `${g.type.replace('_', ' ')}`, body: `Involves ${g.layers.join(', ')}`, layers: g.layers, fix: `Fix the ${g.type.replace('_', ' ')} between ${g.layers.join(' and ')}` })),
		...vl.map((v, i) => ({ key: `v${i}`, sev: v.severity, t: v.t ?? 0, title: v.element, body: v.observation, layers: [] as string[], fix: v.suggestion })),
	].sort((a, z) => z.sev - a.sev || a.t - z.t);
	if (!items.length) return <div className="review empty"><p>No issues were found in the last check.</p></div>;
	return (
		<div className="review">
			<p className="note">{items.length} notes from the last check. Click one to jump there; “Fix with AI” sends it to the assistant with the playhead on that moment.</p>
			{items.map((it) => (
				<div key={it.key} className={`issue sev${it.sev}`}>
					<button className="jump" onClick={() => { seek(Math.max(0, it.t)); if (it.layers.length) select(it.layers); }}>
						<AlertTriangle size={13} /> <b>{it.title}</b> <small>{fmt(it.t)}</small>
					</button>
					<p>{it.body}</p>
					<button className="mini" onClick={() => { seek(Math.max(0, it.t)); void ask(`Fix this: ${it.fix}`); }}><Wand2 size={12} /> Fix with AI</button>
				</div>
			))}
		</div>
	);
};
