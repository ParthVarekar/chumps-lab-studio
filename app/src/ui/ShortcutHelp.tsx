import { Keyboard, X } from 'lucide-react';
import React from 'react';
import { SHORTCUTS } from '../shortcuts';
import { useStudio } from '../store';

/** The shortcut sheet (press ?). Generated from the same table the key handler is documented by. */
export const ShortcutHelp: React.FC = () => {
	const open = useStudio((s) => s.help);
	const set = useStudio((s) => s.set);
	if (!open) return null;
	const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));
	return (
		<div className="help-backdrop" onClick={() => set({ help: false })}>
			<div className="help" onClick={(e) => e.stopPropagation()}>
				<div className="help-head"><Keyboard size={16} /> <b>Keyboard shortcuts</b> <span className="note">Premiere Pro keys where there is an equivalent</span><button className="icon" onClick={() => set({ help: false })} title="Close (Esc)"><X size={14} /></button></div>
				<div className="help-cols">
					{groups.map((g) => (
						<section key={g}>
							<h4>{g}</h4>
							{SHORTCUTS.filter((s) => s.group === g).map((s) => (
								<div key={s.keys + s.does} className="krow"><kbd>{s.keys}</kbd><span>{s.does}</span></div>
							))}
						</section>
					))}
				</div>
			</div>
		</div>
	);
};
