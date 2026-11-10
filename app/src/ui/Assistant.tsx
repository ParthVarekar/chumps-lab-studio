import { Bot, Check, Crosshair, Send, Sparkles, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { find } from '../../shared/ops';
import { fmt, useStudio } from '../store';

const EXAMPLES = [
	'zoom into "Test Condition" and add a whoosh',
	'make this zoom end when I finish the sentence',
	'put a skull sticker where I say "nightmare"',
	'remove the sticker and add a rimshot',
	'make this part less boring',
	'add a small pulsing wifi signal here',
	'make the speedometer needle thicker',
];

export const Assistant: React.FC = () => {
	const msgs = useStudio((s) => s.msgs);
	const draft = useStudio((s) => s.draft);
	const time = useStudio((s) => s.time);
	const sel = useStudio((s) => s.selection);
	const edd = useStudio((s) => s.edd);
	const region = useStudio((s) => s.region);
	const ask = useStudio((s) => s.ask);
	const accept = useStudio((s) => s.accept);
	const discard = useStudio((s) => s.discard);
	const set = useStudio((s) => s.set);
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const end = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, draft]);
	useEffect(() => {
		const f = (e: Event) => { e.preventDefault(); input.current?.focus(); };
		window.addEventListener('focus-assistant', f);
		return () => window.removeEventListener('focus-assistant', f);
	}, []);

	const chips = sel.filter((id) => edd && find(edd, id));
	const send = async (t: string) => {
		const msg = t.trim();
		if (!msg || busy) return;
		setBusy(true);
		setText('');
		await ask(msg, region);
		set({ region: null });
		setBusy(false);
	};

	return (
		<div className="assistant">
			<div className="msgs">
				{!msgs.length ? (
					<div className="intro">
						<Sparkles size={18} />
						<p><b>Tell the editor what to change.</b> It can add, move, retime and remove anything you can on the timeline, and it can invent new animated elements (point at an area first with “point at something”). You see the result before it's saved.</p>
						<p className="note">The playhead ({fmt(time)}) and whatever you've selected are sent with your message, so “this zoom” or “here” work. Typed shortcuts are instant: <code>zoom 1:04 "Test Condition"</code>, <code>sfx 0:20 whoosh</code>, <code>remove b9v7</code>.</p>
						<div className="examples">{EXAMPLES.map((e) => <button key={e} onClick={() => void send(e)}>{e}</button>)}</div>
					</div>
				) : null}
				{msgs.map((m) => (
					<div key={m.id} className={`msg ${m.who}`}>
						{m.who === 'ai' ? <Bot size={14} className="who" /> : null}
						<div className="bubble">
							<p>{m.text}</p>
							{m.notes?.length ? (
								<ul className="notes">{m.notes.map((n, i) => <li key={i} className={n.ok ? 'ok' : 'bad'}>{n.ok ? <Check size={11} /> : <X size={11} />} {n.message}</li>)}</ul>
							) : null}
							{m.options?.length ? <div className="opts">{m.options.map((o) => <button key={o} onClick={() => void send(o)}>{o}</button>)}</div> : null}
							{m.state === 'pending' && draft ? (
								<div className="decide">
									<button className="primary" onClick={() => void accept()}><Check size={14} /> Apply</button>
									<button onClick={() => discard()}>Discard</button>
									<span className="note">Previewing now. Not saved yet.</span>
								</div>
							) : null}
							{m.state === 'applied' ? <span className="state ok">Applied. Ctrl+Z undoes it.</span> : null}
							{m.state === 'discarded' ? <span className="state">Discarded</span> : null}
							{m.source ? <small className="src">{m.source === 'grammar' ? 'instant shortcut' : m.source === 'model' ? (m.via ? `AI: ${m.via.replace(/^[^/]+\//, '').replace(/:free$/, '')}` : 'AI model') : ''}</small> : null}
						</div>
					</div>
				))}
				{busy ? <div className="msg ai"><Bot size={14} className="who" /><div className="bubble typing">thinking…</div></div> : null}
				<div ref={end} />
			</div>
			<div className="composer">
				<div className="context">
					<span className="chip"><b>@</b> {fmt(time)}</span>
					{chips.map((id) => <span key={id} className="chip">{id}</span>)}
					{region ? <span className="chip region">region {Math.round(region.x)},{Math.round(region.y)} · {Math.round(region.w)}×{Math.round(region.h)} <button onClick={() => set({ region: null })}><X size={10} /></button></span> : null}
					<button className="chip btn" onClick={() => set({ pick: { kind: 'region' }, status: 'Drag a box around what you mean' })}><Crosshair size={11} /> point at something</button>
				</div>
				<div className="inputrow">
					<textarea ref={input} rows={2} value={text} placeholder="Ask for an edit…  (Enter to send, Shift+Enter for a new line)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
					<button className="primary round" disabled={!text.trim() || busy} onClick={() => void send(text)} title="Send"><Send size={15} /></button>
				</div>
			</div>
		</div>
	);
};
