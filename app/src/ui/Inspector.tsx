import { Copy, Crosshair, Lock, Play, Scissors, Trash2, Unlock } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { Edd } from '@cls/engine/src/edd/schema';
import { find, spanOf, segments, type Op } from '../../shared/ops';
import { fmt, useStudio } from '../store';

const PRESETS_IN = ['pop', 'slide', 'slide-blur', 'fade', 'drop', 'scale-in', 'typewriter', 'cut'];
const PRESETS_OUT = ['fade', 'scale-out', 'slide', 'cut'];
const DIRS = ['center', 'left', 'right', 'up', 'down'];
const MOODS = ['shock', 'anger', 'sad', 'happy', 'confusion'];
const COLOR_NAMES = ['text', 'accent', 'accent2'];

/** A number box that commits on Enter or blur, so typing "1.25" doesn't fire an edit per key. */
const Num: React.FC<{ label: string; value: number; step?: number; min?: number; max?: number; unit?: string; onCommit: (n: number) => void; disabled?: boolean }> = ({ label, value, step = 0.1, min, max, unit, onCommit, disabled }) => {
	const [v, setV] = useState(String(Math.round(value * 100) / 100));
	useEffect(() => setV(String(Math.round(value * 100) / 100)), [value]);
	const commit = () => {
		const n = Number(v);
		if (Number.isFinite(n) && Math.abs(n - value) > 1e-6) onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
		else setV(String(Math.round(value * 100) / 100));
	};
	return (
		<label className="num">
			<span>{label}</span>
			<input type="number" step={step} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
			{unit ? <small>{unit}</small> : null}
		</label>
	);
};

const Select: React.FC<{ label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }> = ({ label, value, options, onChange, disabled }) => (
	<label className="sel"><span>{label}</span><select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select></label>
);

/** A slider with a number box; it commits when you let go (dragging does not fire an edit per pixel). */
const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onCommit: (n: number) => void }> = ({ label, value, min, max, step, disabled, onCommit }) => {
	const [v, setV] = useState(value);
	useEffect(() => setV(value), [value]);
	const done = () => v !== value && onCommit(v);
	return (
		<label className="num slider">
			<span>{label}</span>
			<span className="sliderrow">
				<input type="range" min={min} max={max} step={step} value={v} disabled={disabled} onChange={(e) => setV(Number(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} />
				<output>{Math.round(v * 100) / 100}</output>
			</span>
		</label>
	);
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
	<section className="isec"><h4>{title}</h4>{children}</section>
);

/** One prop of a component: the editor is chosen from the value, so every component is editable without per-component forms. */
const PropField: React.FC<{ name: string; value: unknown; disabled: boolean; onCommit: (v: unknown) => void; schema?: any }> = ({ name, value, disabled, onCommit, schema }) => {
	const [txt, setTxt] = useState(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
	useEffect(() => setTxt(typeof value === 'string' ? value : JSON.stringify(value, null, 1)), [value]);
	const enumVals: string[] | undefined = schema?.enum ?? schema?.anyOf?.find((x: any) => x.enum)?.enum;
	if (typeof value === 'string' && enumVals?.length && name !== 'color') return <Select label={name.replace(/_/g, ' ')} value={value} options={enumVals} disabled={disabled} onChange={onCommit} />;
	if (typeof value === 'number' && schema && typeof schema.minimum === 'number' && typeof schema.maximum === 'number') {
		const step = schema.type === 'integer' ? 1 : (schema.maximum - schema.minimum) / 100;
		return <Slider label={name.replace(/_/g, ' ')} value={value} min={schema.minimum} max={schema.maximum} step={step} disabled={disabled} onCommit={onCommit} />;
	}
	if (typeof value === 'boolean') return <label className="chk"><input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onCommit(e.target.checked)} /> {name.replace(/_/g, ' ')}</label>;
	if (typeof value === 'number') return <Num label={name} value={value} step={0.1} disabled={disabled} onCommit={onCommit} />;
	if (name === 'color' && typeof value === 'string')
		return (
			<label className="sel"><span>{name}</span>
				<span className="colorrow">
					{/^#[0-9a-f]{6}$/i.test(value) ? <input type="color" value={value} disabled={disabled} onChange={(e) => onCommit(e.target.value)} /> : null}
					<select value={COLOR_NAMES.includes(value) ? value : 'custom'} disabled={disabled} onChange={(e) => onCommit(e.target.value === 'custom' ? '#ffffff' : e.target.value)}>{[...COLOR_NAMES, 'custom'].map((o) => <option key={o}>{o}</option>)}</select>
				</span>
			</label>
		);
	if (name === 'variant') return <Select label={name} value={String(value)} options={['title', 'word', 'header', 'label']} disabled={disabled} onChange={onCommit} />;
	if (name === 'align') return <Select label={name} value={String(value)} options={['left', 'center', 'right']} disabled={disabled} onChange={onCommit} />;
	if (typeof value === 'string' && name === 'src') return <div className="ro"><span>{name}</span><code>{value.split('/').pop()}</code></div>;
	if (typeof value === 'string') {
		const long = value.length > 30 || /code|command|output/.test(name);
		return (
			<label className="txt"><span>{name}</span>
				{long ? <textarea rows={Math.min(8, value.split('\n').length + 1)} value={txt} disabled={disabled} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onCommit(txt)} />
					: <input value={txt} disabled={disabled} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onCommit(txt)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
			</label>
		);
	}
	return (
		<label className="txt"><span>{name} (JSON)</span>
			<textarea rows={4} value={txt} disabled={disabled} onChange={(e) => setTxt(e.target.value)} onBlur={() => { try { const v = JSON.parse(txt); if (JSON.stringify(v) !== JSON.stringify(value)) onCommit(v); } catch { useStudio.getState().set({ status: `${name}: not valid JSON` }); } }} />
		</label>
	);
};

const Badges: React.FC<{ origin: string; locked: boolean }> = ({ origin, locked }) => (
	<span className="badges"><span className={`badge ${origin}`}>{origin === 'user' ? 'You' : origin === 'ai' ? 'AI' : origin}</span>{locked ? <span className="badge lock"><Lock size={10} /> locked</span> : null}</span>
);

export const Inspector: React.FC = () => {
	const edd = useStudio((s) => s.edd);
	const sel = useStudio((s) => s.selection);
	const time = useStudio((s) => s.time);
	const assetBase = useStudio((s) => s.assetBase);
	const run = useStudio((s) => s.run);
	const set = useStudio((s) => s.set);
	if (!edd) return null;
	const ids = sel.filter((id) => find(edd, id));

	if (!ids.length)
		return (
			<div className="inspector empty">
				<h3>Nothing selected</h3>
				<p>Click an item on the timeline to edit it. Drag its handles on the preview to move or resize.</p>
				<dl className="keys">
					<dt>Space</dt><dd>play / pause</dd>
					<dt>← →</dt><dd>one frame (Shift: one second)</dd>
					<dt>S</dt><dd>split at the playhead</dd>
					<dt>[ ]</dt><dd>start / end at the playhead</dd>
					<dt>Del</dt><dd>delete</dd>
					<dt>Ctrl+D</dt><dd>duplicate</dd>
					<dt>Ctrl+Z</dt><dd>undo (Shift: redo)</dd>
					<dt>L</dt><dd>lock / unlock</dd>
					<dt>/</dt><dd>ask the assistant</dd>
				</dl>
			</div>
		);

	if (ids.length > 1)
		return (
			<div className="inspector">
				<h3>{ids.length} items selected</h3>
				<div className="actions">
					<button onClick={() => run(ids.map((id) => ({ op: 'duplicate' as const, id })))}><Copy size={14} /> Duplicate</button>
					<button onClick={() => run(ids.map((id) => ({ op: 'lock' as const, id, locked: true })))}><Lock size={14} /> Lock</button>
					<button className="danger" onClick={() => run(ids.map((id) => ({ op: 'remove' as const, id })))}><Trash2 size={14} /> Delete</button>
				</div>
			</div>
		);

	const id = ids[0];
	const f = find(edd, id)!;
	const span = spanOf(edd, id)!;
	const lockedNow = f.kind === 'layer' ? f.layer!.meta.locked : f.kind === 'camera' ? f.beat!.camera[f.index!].meta.locked : f.kind === 'mood' ? f.beat!.moods[f.index!].meta.locked : f.sfx!.meta.locked;
	const meta = f.kind === 'layer' ? f.layer!.meta : f.kind === 'camera' ? f.beat!.camera[f.index!].meta : f.kind === 'mood' ? f.beat!.moods[f.index!].meta : f.sfx!.meta;
	const dis = lockedNow;
	const go = (op: Op) => void run([op]);
	const title = f.kind === 'layer' ? f.layer!.component : f.kind === 'camera' ? 'Zoom' : f.kind === 'mood' ? 'Mood' : 'Sound effect';

	return (
		<div className="inspector">
			<header className="ihead">
				<h3>{title} <small>{id}</small></h3>
				<Badges origin={meta.origin} locked={lockedNow} />
			</header>
			{meta.reason ? <p className="why" title="Why this exists">{meta.reason}</p> : null}
			{dis ? <p className="warn">Locked: unlock it to change anything. The AI won't touch it either.</p> : null}

			<Section title="Timing">
				<div className="row3">
					<Num label="Start" value={span.start} step={0.05} min={0} unit="s" disabled={dis} onCommit={(n) => go({ op: 'set_time', id, start: n })} />
					{f.kind !== 'sfx' ? <Num label="End" value={span.end} step={0.05} min={0} unit="s" disabled={dis} onCommit={(n) => go({ op: 'set_time', id, end: n })} /> : null}
					{f.kind !== 'sfx' ? <Num label="Length" value={span.end - span.start} step={0.05} min={0.15} unit="s" disabled={dis} onCommit={(n) => go({ op: 'set_time', id, end: span.start + n })} /> : null}
				</div>
				<div className="actions">
					<button disabled={dis} onClick={() => go({ op: 'set_time', id, start: time, end: f.kind === 'sfx' ? undefined : Math.max(time + 0.2, span.end) })}>Start here</button>
					{f.kind !== 'sfx' ? <button disabled={dis || time <= span.start + 0.1} onClick={() => go({ op: 'set_time', id, end: time })}>End here</button> : null}
					<button onClick={() => useStudio.getState().seekTo(span.start)}><Play size={12} /> Go to start</button>
				</div>
			</Section>

			{f.kind === 'layer' ? <LayerForm edd={edd} id={id} dis={dis} /> : null}

			{f.kind === 'camera' ? (
				<>
					<Section title="Zoom region">
						<div className="row4">
							{(['x', 'y', 'w', 'h'] as const).map((k) => <Num key={k} label={k} value={f.beat!.camera[f.index!].to[k]} step={1} unit="%" disabled={dis} onCommit={(n) => go({ op: 'set_style', id, to: { ...f.beat!.camera[f.index!].to, [k]: n } })} />)}
						</div>
						<div className="actions"><button disabled={dis} onClick={() => set({ pick: { kind: 'retarget', id }, status: 'Drag the new region on the preview' })}><Crosshair size={14} /> Redraw region</button></div>
					</Section>
					<Section title="Motion">
						<div className="row3">
							<Num label="In" value={f.beat!.camera[f.index!].inFrames} step={1} min={1} unit="fr" disabled={dis} onCommit={(n) => go({ op: 'set_style', id, in_frames: Math.round(n) })} />
							<Num label="Out" value={f.beat!.camera[f.index!].outFrames} step={1} min={0} unit="fr" disabled={dis} onCommit={(n) => go({ op: 'set_style', id, out_frames: Math.round(n) })} />
						</div>
					</Section>
				</>
			) : null}

			{f.kind === 'mood' ? (
				<Section title="Mood">
					<Select label="Kind" value={f.beat!.moods[f.index!].kind} options={MOODS} disabled={dis} onChange={(v) => go({ op: 'set_style', id, kind: v as never })} />
					<label className="num"><span>Strength</span><input type="range" min={0} max={1} step={0.05} value={f.beat!.moods[f.index!].intensity} disabled={dis} onChange={(e) => go({ op: 'set_style', id, intensity: Number(e.target.value) })} /></label>
				</Section>
			) : null}

			{f.kind === 'sfx' ? (
				<Section title="Sound">
					<div className="ro"><span>file</span><code>{f.sfx!.src.split('/').pop()}</code></div>
					<label className="num"><span>Volume</span><input type="range" min={0} max={1} step={0.05} value={Math.min(1, f.sfx!.volume)} disabled={dis} onChange={(e) => go({ op: 'set_style', id, volume: Number(e.target.value) })} /><small>{Math.round(f.sfx!.volume * 100)}%</small></label>
					<div className="actions"><button onClick={() => { const a = new Audio(`${assetBase}${f.sfx!.src}`); a.volume = Math.min(1, f.sfx!.volume); void a.play(); }}><Play size={12} /> Play</button><button onClick={() => set({ leftTab: 'sounds' })}>Pick another…</button></div>
				</Section>
			) : null}

			<div className="actions foot">
				<button onClick={() => go({ op: 'duplicate', id })}><Copy size={14} /> Duplicate</button>
				{f.kind === 'layer' ? <button disabled={dis || time <= span.start + 0.2 || time >= span.end - 0.2} onClick={() => go({ op: 'split', id, at: time })}><Scissors size={14} /> Split here</button> : null}
				<button onClick={() => go({ op: 'lock', id, locked: !lockedNow })}>{lockedNow ? <Unlock size={14} /> : <Lock size={14} />} {lockedNow ? 'Unlock' : 'Lock'}</button>
				<button className="danger" disabled={dis} onClick={() => go({ op: 'remove', id })}><Trash2 size={14} /> Delete</button>
			</div>
			<p className="note">{fmt(span.start)} → {fmt(span.end)}</p>
		</div>
	);
};

const LayerForm: React.FC<{ edd: Edd; id: string; dis: boolean }> = ({ edd, id, dis }) => {
	const run = useStudio((s) => s.run);
	const segs = segments(edd, id);
	const l = segs[0].layer;
	const last = segs[segs.length - 1].layer;
	const go = (op: Op) => void run([op]);
	const schemas = useStudio((st) => st.schemas);
	const props = (schemas[l.component]?.schema.properties ?? {}) as Record<string, any>;
	return (
		<>
			<Section title={l.space === 'stage' ? 'Position (on the UI)' : 'Position & size'}>
				<div className="row4">
					{(['x', 'y', 'w', 'h'] as const).map((k) => <Num key={k} label={k} value={l.box[k]} step={0.5} unit="%" disabled={dis} onCommit={(n) => go({ op: 'set_box', id, box: { [k]: n } })} />)}
				</div>
				<div className="row3"><Num label="Rotate" value={l.box.rotation ?? 0} step={1} min={-180} max={180} unit="deg" disabled={dis} onCommit={(n) => go({ op: 'set_box', id, box: { rotation: n } })} /></div>
			</Section>
			{l.component === 'Generated' ? <ElementSettings id={id} layer={l} dis={dis} /> : null}
			<Section title={l.component === 'Generated' ? 'Look' : 'Content'}>
				{Object.entries(l.props)
					.filter(([k]) => !(l.component === 'Generated' && (k === 'spec' || k === 'params')) && !(l.component === 'Captions' && k === 'words'))
					.map(([k, v]) => <PropField key={k} name={k} value={v} schema={props[k]} disabled={dis} onCommit={(nv) => go({ op: 'set_props', id, props: { [k]: nv } })} />)}
				{l.component === 'Captions' ? <p className="note">{(l.props.words as unknown[] | undefined)?.length ?? 0} words from the transcript.</p> : null}
				{!Object.keys(l.props).filter((k) => !['spec', 'params', 'words'].includes(k)).length && l.component !== 'Generated' ? <p className="note">No settings.</p> : null}
			</Section>
			<Section title="Animation">
				<div className="row3">
					<Select label="In" value={l.enter.preset} options={PRESETS_IN} disabled={dis} onChange={(v) => go({ op: 'set_style', id, enter: { preset: v as never } })} />
					<Select label="From" value={l.enter.direction} options={DIRS} disabled={dis} onChange={(v) => go({ op: 'set_style', id, enter: { direction: v as never } })} />
					<Num label="Frames" value={l.enter.durationFrames} step={1} min={0} disabled={dis} onCommit={(n) => go({ op: 'set_style', id, enter: { durationFrames: Math.round(n) } })} />
				</div>
				<div className="row3">
					<Select label="Out" value={last.exit?.preset ?? 'fade'} options={PRESETS_OUT} disabled={dis || !last.exit} onChange={(v) => go({ op: 'set_style', id, exit: { preset: v as never } })} />
					<Num label="Frames" value={last.exit?.durationFrames ?? 5} step={1} min={0} disabled={dis || !last.exit} onCommit={(n) => go({ op: 'set_style', id, exit: { durationFrames: Math.round(n) } })} />
					<Num label="Layer" value={l.z} step={1} disabled={dis} onCommit={(n) => go({ op: 'set_style', id, z: Math.round(n) })} />
				</div>
			</Section>
		</>
	);
};

/** The settings the AI (or a preset) gave this element, plus "change it in words" and "save". */
const ElementSettings: React.FC<{ id: string; layer: Edd['beats'][0]['layers'][0]; dis: boolean }> = ({ id, layer, dis }) => {
	const run = useStudio((st) => st.run);
	const refine = useStudio((st) => st.refine);
	const save = useStudio((st) => st.saveElement);
	const designing = useStudio((st) => st.designing);
	const spec = layer.props.spec as { name: string; description?: string; params: { key: string; label: string; type: string; min?: number; max?: number; step?: number; default: unknown; options?: string[] }[] };
	const params = ((layer.props.params as Record<string, unknown>) ?? {}) as Record<string, unknown>;
	const [ask, setAsk] = useState('');
	const [name, setName] = useState(spec?.name ?? 'My element');
	if (!spec) return null;
	const setParam = (key: string, v: unknown) => void run([{ op: 'set_props', id, props: { params: { ...params, [key]: v } } }]);
	return (
		<>
			<Section title={`${spec.name}: settings`}>
				{spec.description ? <p className="note">{spec.description}</p> : null}
				{spec.params.map((p) => {
					const v = params[p.key] ?? p.default;
					if (p.type === 'number') return <Slider key={p.key} label={p.label} value={Number(v)} min={p.min ?? 0} max={p.max ?? 100} step={p.step ?? ((p.max ?? 100) - (p.min ?? 0)) / 100} disabled={dis} onCommit={(n) => setParam(p.key, n)} />;
					if (p.type === 'toggle') return <label key={p.key} className="chk"><input type="checkbox" checked={!!v} disabled={dis} onChange={(e) => setParam(p.key, e.target.checked)} /> {p.label}</label>;
					if (p.type === 'select') return <Select key={p.key} label={p.label} value={String(v)} options={p.options ?? []} disabled={dis} onChange={(x) => setParam(p.key, x)} />;
					if (p.type === 'color') return <label key={p.key} className="sel"><span>{p.label}</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : ({ accent: '#FFD60A', accent2: '#FF453A', white: '#FFFFFF', text: '#FFFFFF', black: '#000000', ink: '#000000' } as Record<string, string>)[String(v)] ?? '#FFD60A'} disabled={dis} onChange={(e) => setParam(p.key, e.target.value)} /></label>;
					return <PropField key={p.key} name={p.label} value={String(v)} disabled={dis} onCommit={(x) => setParam(p.key, x)} />;
				})}
				{!spec.params.length ? <p className="note">This element has no settings.</p> : null}
			</Section>
			<Section title="Change it in words">
				<textarea rows={2} value={ask} placeholder="e.g. thicker needle, make it red, add a second dial…" onChange={(e) => setAsk(e.target.value)} />
				<div className="actions"><button disabled={!ask.trim() || !!designing || dis} onClick={() => { void refine(id, ask); setAsk(''); }}>{designing ? 'Working…' : 'Change it'}</button></div>
			</Section>
			<Section title="Keep it">
				<div className="row2"><input value={name} onChange={(e) => setName(e.target.value)} /><button onClick={() => void save(name, layer.props.spec, params)}>Save to my elements</button></div>
			</Section>
		</>
	);
};
