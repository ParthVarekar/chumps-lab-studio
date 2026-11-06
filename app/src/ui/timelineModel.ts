/** Edit → timeline rows. Everything is in global seconds; item ids are the ids the command layer uses. */
import type { TimelineAction, TimelineEffect, TimelineRow } from '@xzdarcy/timeline-engine';
import type { Edd } from '@cls/engine/src/edd/schema';
import { camId, isContinuation, moodId, segments } from '../../shared/ops';

export interface RowMeta { label: string; kind: 'video' | 'voice' | 'camera' | 'screen' | 'stage' | 'mood' | 'sfx' }
export interface ItemMeta { label: string; kind: 'layer' | 'camera' | 'mood' | 'sfx'; locked: boolean; origin: string; component?: string }

export const EFFECTS: Record<string, TimelineEffect> = Object.fromEntries(
	['beat', 'voice', 'camera', 'mood', 'sfx', 'Title', 'KineticWord', 'Header', 'PopImage', 'MemeSticker', 'EvidenceCard', 'MemeCut', 'UILabel', 'ColorChip', 'CodeBlock', 'Terminal', 'BarChart', 'Gauge', 'NeuralNet', 'Highlight', 'Spotlight', 'BlurRegion', 'Arrow', 'ClickRipple', 'StepBadge', 'LowerThird', 'Flash', 'FadeBlack', 'Wipe', 'Glitch', 'Vignette', 'Letterbox', 'Captions', 'Generated'].map((k) => [k, { id: k, name: k }]),
);

const short = (s: unknown, n = 22) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

function lanes<T extends { start: number; end: number }>(items: T[]): T[][] {
	const out: T[][] = [];
	for (const it of [...items].sort((a, z) => a.start - z.start)) {
		const lane = out.find((l) => l[l.length - 1].end <= it.start + 1e-3);
		if (lane) lane.push(it);
		else out.push([it]);
	}
	return out;
}

export function buildRows(edd: Edd, duration: number): { rows: TimelineRow[]; rowMeta: Record<string, RowMeta>; items: Record<string, ItemMeta> } {
	const rows: TimelineRow[] = [];
	const rowMeta: Record<string, RowMeta> = {};
	const items: Record<string, ItemMeta> = {};
	const add = (id: string, label: string, kind: RowMeta['kind'], actions: TimelineAction[]) => {
		rows.push({ id, actions, rowHeight: kind === 'voice' ? 38 : undefined });
		rowMeta[id] = { label, kind };
	};

	add('beats', 'Video', 'video', edd.beats.map((b) => ({ id: `beat:${b.id}`, start: b.start, end: b.end, effectId: 'beat', movable: false, flexible: false })));
	add('voice', 'Voice', 'voice', edd.audio.voice ? [{ id: 'voice', start: 0, end: duration, effectId: 'voice', movable: false, flexible: false }] : []);

	const cams: TimelineAction[] = [];
	for (const b of edd.beats)
		b.camera.forEach((c, i) => {
			const id = camId(b, i);
			const start = b.start + c.at;
			cams.push({ id, start, end: start + c.inFrames / 30 + c.hold + c.outFrames / 30, effectId: 'camera', movable: !c.meta.locked, flexible: !c.meta.locked });
			items[id] = { label: 'zoom', kind: 'camera', locked: c.meta.locked, origin: c.meta.origin };
		});
	add('camera', 'Camera', 'camera', cams);

	for (const space of ['screen', 'stage'] as const) {
		const list: { id: string; start: number; end: number; layer: Edd['beats'][0]['layers'][0] }[] = [];
		const seen = new Set<string>();
		for (const b of edd.beats)
			for (const l of b.layers) {
				if (l.space !== space || isContinuation(l) || seen.has(l.id)) continue;
				seen.add(l.id);
				const segs = segments(edd, l.id);
				list.push({ id: l.id, start: segs[0].start, end: segs[segs.length - 1].end, layer: l });
			}
		const ln = lanes(list);
		ln.forEach((lane, i) =>
			add(`${space}-${i}`, space === 'screen' ? `Overlay ${i + 1}` : `On UI ${i + 1}`, space, lane.map((it) => {
				items[it.id] = { label: it.layer.component === 'Generated' ? `Element · ${short((it.layer.props.spec as { name?: string } | undefined)?.name ?? '')}` : `${it.layer.component}${it.layer.props.text ? ` · ${short(it.layer.props.text)}` : ''}`, kind: 'layer', locked: it.layer.meta.locked, origin: it.layer.meta.origin, component: it.layer.component };
				return { id: it.id, start: it.start, end: it.end, effectId: it.layer.component, movable: !it.layer.meta.locked, flexible: !it.layer.meta.locked };
			})),
		);
		if (!ln.length) add(`${space}-0`, space === 'screen' ? 'Overlay 1' : 'On UI 1', space, []);
	}

	const moods: TimelineAction[] = [];
	for (const b of edd.beats)
		b.moods.forEach((m, i) => {
			const id = moodId(b, i);
			moods.push({ id, start: b.start + m.at, end: b.start + m.at + m.duration, effectId: 'mood', movable: !m.meta.locked, flexible: !m.meta.locked });
			items[id] = { label: m.kind, kind: 'mood', locked: m.meta.locked, origin: m.meta.origin };
		});
	add('moods', 'Moods', 'mood', moods);

	const sfx = edd.audio.sfx.map((s) => ({ s, start: s.at, end: s.at + 0.5 }));
	const sl = lanes(sfx);
	sl.forEach((lane, i) =>
		add(`sfx-${i}`, i === 0 ? 'Sound' : '', 'sfx', lane.map((it) => {
			items[it.s.id] = { label: it.s.role ?? 'sound', kind: 'sfx', locked: it.s.meta.locked, origin: it.s.meta.origin };
			return { id: it.s.id, start: it.start, end: it.end, effectId: 'sfx', movable: !it.s.meta.locked, flexible: false };
		})),
	);
	if (!sl.length) add('sfx-0', 'Sound', 'sfx', []);
	return { rows, rowMeta, items };
}
