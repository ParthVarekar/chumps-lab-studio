import React, { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useStudio } from './store';
import { Assistant } from './ui/Assistant';
import { Inspector } from './ui/Inspector';
import { Library } from './ui/Library';
import { Preview } from './ui/Preview';
import { Review } from './ui/Review';
import { TimelinePanel } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { useShortcuts } from './shortcuts';
import { ShortcutHelp } from './ui/ShortcutHelp';

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
			<footer className="statusbar"><span>{status}</span><span className="hint">press ? for shortcuts</span></footer>
			<ShortcutHelp />
		</div>
	);
};
