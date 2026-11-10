/**
 * The in-editor AI. A request in plain English becomes commands (shared/ops.ts), the same ones the UI sends.
 *
 * Two routes, both ending in the same Op list:
 *   1. Typed shortcuts, e.g.  zoom 1:04 "Test Condition"   sfx 0:20 whoosh   remove b9v7   (instant, no model, no quota)
 *   2. The fast vision model (nemotron-3.5-super-vl:free, then the local model) for natural language.
 *
 * The model never writes seconds, coordinates or JSON edits. It names WHAT (a sticker id, an item id, on-screen text,
 * a spoken word) and WHERE-IN-TIME as an anchor ("the word 'once' near 20 s"). This file turns those into numbers
 * with the footage's own data: transcript timing, OCR boxes, scroll/cut times. So an AI edit lands as well as a planned one.
 */
import path from 'node:path';
import { z } from 'zod';
import type { Edd } from '@cls/engine/src/edd/schema';
import { find, segments, spanOf, camId, type Op } from '../shared/ops';
import { clauseEnd, loadContext, movingAt, nextMotion, norm, ocrAt, wordNear, type Ctx, type OcrEl } from './context';
import { designElement } from './elements';
import { chatJson } from './llm';
import { ROOT, iconOp, matchIcon, memeCatalog, pickSfx, sfxOp, sfxRoles, soundOp, stickerOp } from './library';

const LEAD = 0.5; // graphics land this much before their word (measured on the creator's own edits)

export interface AssistantArgs { dir: string; edd: Edd; message: string; time: number; selection: string[]; region?: { x: number; y: number; w: number; h: number } }
export interface AssistantReply { reply: string; ops: Op[]; options?: string[]; source: 'grammar' | 'model' | 'none'; ms?: number }

// ------------------------------------------------------------------ small helpers
function parseTime(s: string, now: number): number | null {
	const t = s.trim().toLowerCase();
	if (['now', 'here', 'playhead', 'this point'].includes(t)) return now;
	let m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(t);
	if (m) return Number(m[1]) * 60 + Number(m[2]);
	m = /^(\d+(?:\.\d+)?)\s*s?(?:ec(?:onds?)?)?$/.exec(t);
	return m ? Number(m[1]) : null;
}

const tokens = (s: string) => norm(s).split(' ').filter((w) => w.length > 1);

/** The on-screen text element best matching `text` at time t (UI text only: not window chrome, not huge overlay text). */
function findTarget(ctx: Ctx, text: string, t: number): { el: OcrEl | null; alternatives: string[] } {
	const els = ocrAt(ctx, t).filter((e) => e.rect.y >= 7 && e.rect.h < 8);
	const want = tokens(text);
	let best: OcrEl | null = null;
	let bestScore = 0;
	const phrase = norm(text);
	for (const e of els) {
		const et = norm(e.text);
		const have = new Set(tokens(e.text));
		const hit = want.filter((w) => have.has(w) || [...have].some((h) => h.length > 3 && w.length > 3 && (h.startsWith(w) || w.startsWith(h)))).length;
		if (!want.length || hit / want.length < 0.6) continue;
		// Prefer text that IS what was asked for: starts with the phrase > contains it > merely shares the words; short beats long.
		let score = hit / want.length + (et.startsWith(phrase) ? 0.5 : et.includes(phrase) ? 0.25 : 0) - Math.max(0, tokens(e.text).length - want.length) * 0.02;
		if (et === phrase) score += 0.3;
		if (score > bestScore) (best = e), (bestScore = score);
	}
	const alts = [...new Set(els.map((e) => e.text.replace(/\s+/g, ' ').slice(0, 40)))].slice(0, 5);
	return { el: best, alternatives: alts };
}

// ------------------------------------------------------------------ anchors (symbolic time → seconds)
const AnchorSchema = z.object({
	kind: z.enum(['word', 'clause_end', 'seconds', 'now', 'item_start', 'item_end']),
	word: z.string().nullable().describe('the spoken word, as in the transcript (kind word / clause_end)'),
	near: z.number().nullable().describe('seconds: pick the occurrence of the word closest to this time'),
	seconds: z.number().nullable().describe('kind seconds only, and only if the user said an explicit time'),
	item_id: z.string().nullable().describe('kind item_start / item_end: an id from ITEMS'),
	offset: z.number().nullable().describe('seconds to add afterwards, e.g. 0.3'),
});
type Anchor = z.infer<typeof AnchorSchema>;

function resolveAnchor(a: Anchor, ctx: Ctx, edd: Edd, now: number, forGraphic: boolean): number {
	let t: number;
	switch (a.kind) {
		case 'now': t = now; break;
		case 'seconds': t = a.seconds ?? now; break;
		case 'item_start':
		case 'item_end': {
			const sp = a.item_id ? spanOf(edd, a.item_id) : null;
			if (!sp) throw new Error(`I can't find ${a.item_id ?? 'that item'}`);
			t = a.kind === 'item_start' ? sp.start : sp.end;
			break;
		}
		default: {
			const i = wordNear(ctx, a.word ?? '', a.near ?? now);
			if (i < 0) throw new Error(`I can't find the word “${a.word}” near ${(a.near ?? now).toFixed(0)} s in the script`);
			t = a.kind === 'clause_end' ? clauseEnd(ctx, i) : ctx.words[i].start - (forGraphic ? LEAD : 0);
		}
	}
	return Math.max(0, t + (a.offset ?? 0));
}

// ------------------------------------------------------------------ intent → raw ops (the same placement rules as the planner)
function zoomOps(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, at: number, until: number | null, why: string): Op[] {
	const mv = movingAt(ctx, at + 0.2);
	if (mv) at = mv[1] + 0.1 - 0.2; // wait for the scroll / switch to settle
	const next = nextMotion(ctx, at + 0.4);
	const wi = wordNear(ctx, '', at);
	void wi;
	let end = until ?? at + 2.5;
	if (next) end = Math.min(end, next - 0.12);
	end = Math.min(end, at + 6);
	if (end - at < 1.0) end = at + 1.0;
	const size = Math.min(80, Math.max(32, Math.max(rect.w, (rect.h * 16) / 9) * 2));
	const cx = rect.x + rect.w / 2;
	const cy = rect.y + rect.h / 2;
	const x = Math.min(Math.max(cx - size / 2, 0), 100 - size);
	const y = Math.min(Math.max(cy - size / 2, 0), 100 - size);
	return [{ op: 'add_zoom', at: +at.toFixed(2), until: +end.toFixed(2), to: { x: +x.toFixed(2), y: +y.toFixed(2), w: size, h: size }, why }];
}

function labelOps(ctx: Ctx, rect: { x: number; y: number; w: number; h: number }, text: string, at: number, why: string): Op[] {
	const next = nextMotion(ctx, at + 0.4);
	let end = at + 2.6;
	if (next) end = Math.min(end, next - 0.08);
	if (end - at < 1) end = at + 1;
	const w = Math.min(40, Math.max(14, text.length * 1.35 + 6));
	const x = Math.min(Math.max(rect.x + rect.w / 2 - w / 2, 2), 98 - w);
	const below = rect.y + rect.h + 2.5;
	const y = below + 6 < 95 ? below : Math.max(5, rect.y - 7.5);
	const pad = 1;
	return [{ op: 'add_layer', component: 'UILabel', at: +at.toFixed(2), until: +end.toFixed(2), props: { text, target: { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.w + 2 * pad, h: rect.h + 2 * pad } }, box: { x: +x.toFixed(2), y: +y.toFixed(2), w, h: 6 }, why }];
}

// ------------------------------------------------------------------ 1. typed shortcuts
const Q = `["“'](.+?)["”']`;
function grammar(a: AssistantArgs, ctx: Ctx): AssistantReply | null {
	const msg = a.message.trim();
	const T = (s: string) => parseTime(s, a.time);
	const done = (reply: string, ops: Op[]): AssistantReply => ({ reply, ops, source: 'grammar' });
	const fail = (reply: string, options?: string[]): AssistantReply => ({ reply, ops: [], options, source: 'grammar' });
	let m: RegExpExecArray | null;

	if ((m = new RegExp(`^zoom(?:\\s+(?:into|on|in))?\\s+(?:(\\S+)\\s+)?${Q}(?:\\s+(?:at|@)\\s+(\\S+))?$`, 'i').exec(msg))) {
		const t = T(m[1] ?? m[3] ?? 'now');
		if (t === null) return fail('I couldn’t read that time. Try 1:04 or 64.');
		const { el, alternatives } = findTarget(ctx, m[2], t);
		if (!el) return fail(`I can't see “${m[2]}” on screen at ${t.toFixed(1)} s.`, alternatives.length ? alternatives.map((x) => `zoom ${t.toFixed(1)} "${x}"`) : undefined);
		return done(`Zoom into “${el.text.slice(0, 40)}” at ${t.toFixed(1)} s.`, zoomOps(ctx, el.rect, t, null, `zoom on “${el.text.slice(0, 30)}” (you asked)`));
	}
	if ((m = new RegExp(`^label\\s+(?:(\\S+)\\s+)?${Q}(?:\\s+as\\s+${Q})?$`, 'i').exec(msg))) {
		const t = T(m[1] ?? 'now');
		if (t === null) return fail('I couldn’t read that time.');
		const { el, alternatives } = findTarget(ctx, m[2], t);
		if (!el) return fail(`I can't see “${m[2]}” on screen at ${t.toFixed(1)} s.`, alternatives.map((x) => `label ${t.toFixed(1)} "${x}"`));
		return done(`Label “${m[3] ?? m[2]}” on that element.`, labelOps(ctx, el.rect, m[3] ?? m[2], t, `label “${m[3] ?? m[2]}” (you asked)`));
	}
	if ((m = new RegExp(`^(title|big|header)\\s+(?:(\\S+)\\s+)?${Q}$`, 'i').exec(msg))) {
		const t = T(m[2] ?? 'now');
		if (t === null) return fail('I couldn’t read that time.');
		const comp = m[1].toLowerCase() === 'title' ? 'Title' : m[1].toLowerCase() === 'big' ? 'KineticWord' : 'Header';
		return done(`Add ${comp === 'KineticWord' ? 'a big word' : comp.toLowerCase()} “${m[3]}” at ${t.toFixed(1)} s.`, [{ op: 'add_layer', component: comp, at: t, until: comp === 'Header' ? t + 6 : undefined, props: { text: comp === 'KineticWord' ? m[3].toUpperCase() : m[3] }, why: 'you asked' }]);
	}
	if ((m = /^sfx\s+(\S+)\s+(\w+)$/i.exec(msg)) || (m = /^(?:add|put)\s+(?:a\s+)?(\w+)\s+(?:sound\s+)?(?:at|@)\s+(\S+)$/i.exec(msg))) {
		const [timeStr, role] = /^\d|now|here/i.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
		const t = T(timeStr);
		const op = t === null ? null : soundOp(a.dir, role.toLowerCase(), `${a.dir}:${t}`, t, 0.5, 'you asked');
		if (t === null || !op) return fail(`I don’t have a “${role}” sound. Roles: ${sfxRoles().join(', ')}.`, sfxRoles().slice(0, 6).map((r) => `sfx ${timeStr} ${r}`));
		return done(`Add a ${role} sound at ${t.toFixed(1)} s.`, [op]);
	}
	if ((m = /^(?:remove|delete)\s+(\S+)$/i.exec(msg)) && find(a.edd, m[1])) return done(`Remove ${m[1]}.`, [{ op: 'remove', id: m[1] }]);
	if ((m = /^(lock|unlock)\s+(\S+)$/i.exec(msg)) && find(a.edd, m[2])) return done(`${m[1]} ${m[2]}.`, [{ op: 'lock', id: m[2], locked: m[1].toLowerCase() === 'lock' }]);
	if ((m = /^(?:move|retime)\s+(\S+)\s+(?:to|at)\s+(\S+)$/i.exec(msg)) && find(a.edd, m[1])) {
		const t = T(m[2]);
		return t === null ? fail('I couldn’t read that time.') : done(`Move ${m[1]} to ${t.toFixed(1)} s.`, [{ op: 'set_time', id: m[1], start: t }]);
	}
	if ((m = /^(?:nudge|shift)\s+(\S+)\s+([+-]?\d*\.?\d+)\s*s?$/i.exec(msg)) && find(a.edd, m[1])) {
		const sp = spanOf(a.edd, m[1])!;
		return done(`Shift ${m[1]} by ${m[2]} s.`, [{ op: 'set_time', id: m[1], start: sp.start + Number(m[2]) }]);
	}
	if ((m = /^(start|end)\s+(\S+)\s+(?:at|@)\s+(\S+)$/i.exec(msg)) && find(a.edd, m[2])) {
		const t = T(m[3]);
		return t === null ? fail('I couldn’t read that time.') : done(`${m[1] === 'start' ? 'Start' : 'End'} ${m[2]} at ${t.toFixed(1)} s.`, [{ op: 'set_time', id: m[2], [m[1].toLowerCase() === 'start' ? 'start' : 'end']: t } as Op]);
	}
	if ((m = /^mood\s+(?:(\S+)\s+)?(shock|anger|sad|happy|confusion)$/i.exec(msg))) {
		const t = T(m[1] ?? 'now');
		return t === null ? fail('I couldn’t read that time.') : done(`Add a ${m[2]} mood at ${t.toFixed(1)} s.`, [{ op: 'add_mood', kind: m[2].toLowerCase() as never, at: t, duration: 1.2 }]);
	}
	return null;
}

// ------------------------------------------------------------------ 2. the model
const OpSchemas = (stickers: string[], roles: string[]) => {
	const why = z.string().describe('one short sentence');
	const o = <T extends string, S extends z.ZodRawShape>(op: T, shape: S) => z.object({ op: z.literal(op), ...shape, why });
	return z.discriminatedUnion('op', [
		o('add_zoom', { start: AnchorSchema, target_text: z.string().describe('on-screen text to zoom into, copied from ON SCREEN'), end: AnchorSchema.nullable().describe('when the zoom goes back out; null = automatic') }),
		o('add_label', { at: AnchorSchema, target_text: z.string().describe('on-screen text to point at, copied from ON SCREEN'), text: z.string().describe('the label to show') }),
		o('add_title', { at: AnchorSchema, text: z.string() }),
		o('add_kinetic', { at: AnchorSchema, text: z.string().describe('one word, shown as big type') }),
		o('add_header', { at: AnchorSchema, text: z.string() }),
		o('add_sticker', { at: AnchorSchema, sticker: z.enum(stickers as [string, ...string[]]) }),
		o('add_logo', { at: AnchorSchema, brand: z.string().describe('a real product, brand or software name') }),
		o('add_sfx', { at: AnchorSchema, role: z.enum(roles as [string, ...string[]]) }),
		o('add_mood', { at: AnchorSchema, kind: z.enum(['shock', 'anger', 'sad', 'happy', 'confusion']) }),
		o('remove', { item_id: z.string().describe('exactly one id from ITEMS') }),
		o('retime', { item_id: z.string().describe('exactly one id from ITEMS'), edge: z.enum(['start', 'end', 'move']), to: AnchorSchema.nullable(), delta: z.number().nullable().describe('seconds to shift by instead of an anchor, e.g. -0.3') }),
		o('set_text', { item_id: z.string(), text: z.string() }),
		o('set_volume', { item_id: z.string(), volume: z.number().describe('0 to 1') }),
		o('lock', { item_id: z.string(), locked: z.boolean() }),
		o('group', { item_ids: z.array(z.string()).min(2).describe('ids from ITEMS to link so they move, copy, lock and delete together, e.g. a zoom and the spotlight on it') }),
		o('ungroup', { item_id: z.string().describe('any member of the group') }),
		o('set_enabled', { item_id: z.string(), enabled: z.boolean().describe('false = switch off without deleting (to compare), true = switch back on') }),
		o('add_marker', { at: AnchorSchema, label: z.string().nullable() }),
		o('create_element', { at: AnchorSchema, seconds: z.number().describe('how long it stays, e.g. 3'), brief: z.string().describe('what to make, in the users own words, e.g. "small animated speedometer showing 78%"') }),
		o('refine_element', { item_id: z.string().describe('an id from ITEMS whose type is Generated'), instruction: z.string() }),
		z.object({ op: z.literal('ask'), question: z.string(), options: z.array(z.string()).describe('2-4 short choices the user can click'), why }),
	]);
};

function pack(a: AssistantArgs, ctx: Ctx): string {
	const focus = a.selection.map((id) => spanOf(a.edd, id)).filter(Boolean) as { start: number; end: number }[];
	const lo = Math.min(a.time, ...focus.map((s) => s.start)) - 8;
	const hi = Math.max(a.time, ...focus.map((s) => s.end)) + 8;
	const items: string[] = [];
	const seen = new Set<string>();
	for (const b of a.edd.beats) {
		for (const l of b.layers) {
			if (seen.has(l.id.replace(/-b\d+$/, '')) || /^continues /.test(String(l.meta.reason ?? ''))) continue;
			seen.add(l.id);
			const sp = spanOf(a.edd, l.id)!;
			if (sp.end >= lo && sp.start <= hi) items.push(`${l.id}: ${l.component}${l.props.text ? ` “${String(l.props.text).slice(0, 30)}”` : ''} ${sp.start.toFixed(1)}-${sp.end.toFixed(1)}s${l.meta.locked ? ' LOCKED' : ''}${l.meta.group ? ` group=${l.meta.group}` : ''}${l.meta.disabled ? ' OFF' : ''}`);
		}
		b.camera.forEach((c, i) => {
			const sp = spanOf(a.edd, camId(b, i))!;
			if (sp.end >= lo && sp.start <= hi) items.push(`${camId(b, i)}: zoom ${sp.start.toFixed(1)}-${sp.end.toFixed(1)}s${c.meta.group ? ` group=${c.meta.group}` : ''}${c.meta.disabled ? ' OFF' : ''}`);
		});
	}
	for (const s of a.edd.audio.sfx) if (s.at >= lo && s.at <= hi) items.push(`${s.id}: sound ${s.role ?? ''} at ${s.at.toFixed(1)}s`);
	const words = ctx.words.filter((w) => w.start >= lo && w.start <= hi).map((w) => `${w.text}@${w.start.toFixed(1)}`).join(' ');
	const screen = [...new Set(ocrAt(ctx, a.time).filter((e) => e.rect.y >= 7 && e.rect.h < 8).map((e) => e.text.replace(/\s+/g, ' ').slice(0, 50)))].slice(0, 24);
	// Words the user names are looked up across the WHOLE transcript ("where I say nightmare" can be anywhere).
	const STOP = new Set(['where', 'when', 'what', 'this', 'that', 'with', 'then', 'there', 'here', 'put', 'add', 'make', 'the', 'and', 'say', 'said', 'finish', 'saying', 'sticker', 'zoom', 'sound', 'title', 'remove', 'before', 'after', 'into']);
	const named = [...new Set(a.message.toLowerCase().match(/[a-z']{4,}/g) ?? [])].filter((w) => !STOP.has(w));
	const mentioned = named
		.map((w) => ({ w, at: ctx.words.filter((x) => norm(x.text) === w).slice(0, 4).map((x) => x.start.toFixed(1)) }))
		.filter((m) => m.at.length)
		.map((m) => `${m.w}: ${m.at.join(', ')} s`)
		.join('; ');
	const sel = a.selection.length ? `SELECTED: ${a.selection.join(', ')}\n` : '';
	const region = a.region ? `POINTED AT (region of the frame, % x,y,w,h): ${a.region.x.toFixed(0)},${a.region.y.toFixed(0)},${a.region.w.toFixed(0)},${a.region.h.toFixed(0)}; on-screen text inside it: ${JSON.stringify(ocrAt(ctx, a.time).filter((e) => e.rect.x < a.region!.x + a.region!.w && e.rect.x + e.rect.w > a.region!.x && e.rect.y < a.region!.y + a.region!.h && e.rect.y + e.rect.h > a.region!.y).map((e) => e.text.slice(0, 40)).slice(0, 6))}\n` : '';
	return `PLAYHEAD: ${a.time.toFixed(1)} s\n${sel}${region}ITEMS (ids you may use): \n${items.join('\n') || '(none)'}\nWORDS (word@seconds): ${words}\nWORDS YOU NAMED, EVERYWHERE THEY ARE SPOKEN: ${mentioned || '(none)'}\nON SCREEN at the playhead: ${JSON.stringify(screen)}`;
}

const SYSTEM = `You are the editing assistant inside a video editor for a faceless tech YouTube channel. The video is a screen recording with
motion graphics on top. You translate the user's request into edit operations. You never write code or raw JSON edits.

Rules:
- Use ONLY ids from ITEMS and on-screen text from ON SCREEN. Never invent an id.
- Say WHEN with an anchor: {kind: "word", word, near} for a spoken word (near = roughly where, in seconds), "clause_end" for the end of the sentence part containing that word,
  "now" for the playhead, "item_start"/"item_end" for an existing item, or {kind: "seconds"} ONLY when the user gave an explicit time (1:04 = 64).
- "this", "it", "here" mean the SELECTED item(s) or the playhead. If something selected is a zoom and the user says it ends too late, use retime on that id (edge end), do NOT add a new zoom.
- To change how long a zoom is held, "when I finish saying X" = retime edge end, to {kind: "clause_end", word X}.
- Keep it minimal: do exactly what was asked. If the request is vague ("make it better"), or you cannot find what they mean, return one ask op with 2-4 clickable options.
- To MAKE a new animated thing that is not a sticker or logo (a speedometer, a wifi signal, a plant, a progress bar, a loading ring) use create_element with the user's words as the brief.
  To change one that already exists (type Generated in ITEMS) use refine_element.
- Items can be GROUPED (shown as group=g1 in ITEMS): a grouped item moves, copies, locks and deletes with its group. To make a zoom and an effect on the same spot (e.g. a spotlight) work together, add both and then use group on their ids, or group existing ones. Use ungroup to split them.
- "turn off / mute / hide / compare without" = set_enabled false (it stays in the edit); "turn it back on" = set_enabled true. Use remove only when they want it gone.
- "mark / bookmark / chapter at X" = add_marker.
- "say" is one friendly sentence describing what you will do.`;

async function askModel(a: AssistantArgs, ctx: Ctx): Promise<AssistantReply> {
		const stickers = memeCatalog().memes.map((m) => m.id);
	const roles = sfxRoles();
	const Out = z.object({ say: z.string(), ops: z.array(OpSchemas(stickers, roles)) });
	const schema = z.toJSONSchema(Out, { target: 'draft-7' });
	const messages: { role: string; content: string }[] = [{ role: 'system', content: SYSTEM + `\nSTICKERS: ${stickers.join(', ')}\nSOUND ROLES: ${roles.join(', ')}` }, { role: 'user', content: `${pack(a, ctx)}\n\nREQUEST: ${a.message}` }];
	const t0 = Date.now();
	for (let attempt = 0; attempt < 2; attempt++) {
		let content = '';
		try {
			content = await chatJson(messages, { schemaName: 'edit_ops', schema, maxTokens: 2000, temperature: 0.2, timeoutMs: 70000 });
		} catch (e) {
			return { reply: `The AI model didn't answer (${e instanceof Error ? e.message.slice(0, 160) : 'error'}). Typed shortcuts still work: zoom 1:04 "Test Condition", sfx 0:20 whoosh, remove b9v7.`, ops: [], source: 'none', ms: Date.now() - t0 };
		}
		let parsed: z.infer<typeof Out>;
		try {
			parsed = Out.parse(JSON.parse(content));
		} catch (e) {
			messages.push({ role: 'assistant', content }, { role: 'user', content: `That wasn't valid: ${e instanceof Error ? e.message.slice(0, 200) : ''}. Answer again with valid operations.` });
			continue;
		}
		const asks = parsed.ops.filter((o) => o.op === 'ask') as { op: 'ask'; question: string; options: string[] }[];
		if (asks.length) return { reply: asks[0].question, ops: [], options: asks[0].options, source: 'model', ms: Date.now() - t0 };
		const ops: Op[] = [];
		const errors: string[] = [];
		for (const mo of parsed.ops) {
			try {
				ops.push(...(await toOps(mo as never, a, ctx)));
			} catch (e) {
				errors.push(e instanceof Error ? e.message : String(e));
			}
		}
		// One repair round when an id or word didn't resolve: tell the model exactly what was wrong.
		if (errors.length && !ops.length && attempt === 0) {
			messages.push({ role: 'assistant', content }, { role: 'user', content: `Problem: ${errors.join('; ')}. Fix it using only ids and words from the context, or ask the user.` });
			continue;
		}
		const reply = errors.length ? `${parsed.say}\n\nCouldn't do part of it: ${errors.join('; ')}` : parsed.say;
		return { reply, ops, source: 'model', ms: Date.now() - t0 };
	}
	return { reply: 'I couldn’t turn that into an edit. Try a typed shortcut, e.g. zoom 1:04 "Test Condition".', ops: [], source: 'model', ms: Date.now() - t0 };
}

type ModelOp = Record<string, any> & { op: string; why: string };
async function toOps(mo: ModelOp, a: AssistantArgs, ctx: Ctx): Promise<Op[]> {
	const at = (an: Anchor, graphic = true) => resolveAnchor(an, ctx, a.edd, a.time, graphic);
	switch (mo.op) {
		case 'add_zoom': {
			const t = at(mo.start, false);
			const { el, alternatives } = findTarget(ctx, mo.target_text, t);
			if (!el) throw new Error(`I can't see “${mo.target_text}” on screen at ${t.toFixed(1)} s (I can see: ${alternatives.slice(0, 3).join(' | ') || 'nothing readable'})`);
			return zoomOps(ctx, el.rect, t, mo.end ? at(mo.end, false) : null, mo.why);
		}
		case 'add_label': {
			const t = at(mo.at);
			const { el, alternatives } = findTarget(ctx, mo.target_text, t);
			if (!el) throw new Error(`I can't see “${mo.target_text}” on screen at ${t.toFixed(1)} s (I can see: ${alternatives.slice(0, 3).join(' | ') || 'nothing readable'})`);
			return labelOps(ctx, el.rect, mo.text, t, mo.why);
		}
		case 'add_title': return [{ op: 'add_layer', component: 'Title', at: at(mo.at), props: { text: mo.text }, why: mo.why }];
		case 'add_kinetic': return [{ op: 'add_layer', component: 'KineticWord', at: at(mo.at), props: { text: String(mo.text).toUpperCase() }, why: mo.why }];
		case 'add_header': { const t = at(mo.at); return [{ op: 'add_layer', component: 'Header', at: t, until: t + 6, props: { text: mo.text }, why: mo.why }]; }
		case 'add_sticker': {
			const m = memeCatalog().memes.find((x) => x.id === mo.sticker);
			if (!m) throw new Error(`no sticker ${mo.sticker}`);
			const t = at(mo.at);
			const ops: Op[] = [stickerOp(a.dir, m, t, mo.why)];
			const snd = m.sound ? pickSfx(m.sound, m.id) : null;
			const meme = m.sound ? memeCatalog().sounds[m.sound] : null;
			if (meme) ops.push({ op: 'add_sfx', src: `media/sfx/${path.basename(meme.file)}`, at: t + 0.05, volume: 0.55, role: 'meme', why: `sound for ${m.id}` });
			else if (snd) ops.push(sfxOp(a.dir, snd, t + 0.05, 0.5, `sound for ${m.id}`));
			return ops;
		}
		case 'add_logo': {
			const id = matchIcon(mo.brand);
			if (!id) throw new Error(`I don't have a logo for “${mo.brand}”`);
			return [iconOp(a.dir, id, at(mo.at), mo.why)];
		}
		case 'add_sfx': {
			const t = at(mo.at, false);
			const op = soundOp(a.dir, mo.role, `${a.dir}:${t.toFixed(1)}`, t, 0.5, mo.why);
			if (!op) throw new Error(`no ${mo.role} sounds`);
			return [op];
		}
		case 'add_mood': return [{ op: 'add_mood', kind: mo.kind, at: at(mo.at, false), duration: 1.2, why: mo.why }];
		case 'remove': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'remove', id: mo.item_id }];
		case 'group': {
			const ids = (mo.item_ids as string[]).filter((i) => find(a.edd, i));
			if (ids.length < 2) throw new Error('I need at least two existing items to group');
			return [{ op: 'group', ids }];
		}
		case 'ungroup': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'ungroup', id: mo.item_id }];
		case 'set_enabled': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'set_enabled', id: mo.item_id, enabled: !!mo.enabled }];
		case 'add_marker': return [{ op: 'add_marker', at: at(mo.at, false), label: mo.label ?? undefined }];
		case 'lock': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'lock', id: mo.item_id, locked: !!mo.locked }];
		case 'set_text': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'set_props', id: mo.item_id, props: { text: mo.text } }];
		case 'set_volume': if (!find(a.edd, mo.item_id)) throw new Error(`there is no item ${mo.item_id}`); return [{ op: 'set_style', id: mo.item_id, volume: Math.max(0, Math.min(1, Number(mo.volume))) }];
		case 'create_element': {
			const t = at(mo.at, false);
			const secs = Math.max(1, Math.min(12, Number(mo.seconds) || 3));
			const r = await designElement({ dir: a.dir, brief: mo.brief, region: a.region ?? null, time: t, duration: secs });
			if (!r.ok || !r.spec) throw new Error(r.say);
			return [{ op: 'add_layer', component: 'Generated', at: t, until: t + secs, props: { spec: r.spec, params: r.params ?? {} }, box: a.region ?? { x: 38, y: 26, w: 24, h: 42.7 }, space: 'stage', why: `designed for: ${String(mo.brief).slice(0, 80)}` }];
		}
		case 'refine_element': {
			const f = find(a.edd, mo.item_id);
			if (!f || f.kind !== 'layer' || f.layer!.component !== 'Generated') throw new Error(`${mo.item_id} is not a designed element`);
			const sp = spanOf(a.edd, mo.item_id)!;
			const { ElementSpec } = await import('@cls/engine/src/element/spec');
			const cur = ElementSpec.parse((f.layer!.props as { spec: unknown }).spec);
			const r = await designElement({ dir: a.dir, brief: cur.name, region: f.layer!.box, time: sp.start, duration: sp.end - sp.start, current: { spec: cur, params: ((f.layer!.props as { params?: Record<string, unknown> }).params ?? {}) }, instruction: mo.instruction });
			if (!r.ok || !r.spec) throw new Error(r.say);
			return [{ op: 'set_props', id: mo.item_id, props: { spec: r.spec, params: r.params ?? {} } }];
		}
		case 'retime': {
			const f = find(a.edd, mo.item_id);
			const sp = f ? spanOf(a.edd, mo.item_id) : null;
			if (!f || !sp) throw new Error(`there is no item ${mo.item_id}`);
			let t: number | null = null;
			if (mo.to) t = at(mo.to, mo.edge !== 'end' && f.kind === 'layer');
			const outPad = f.kind === 'camera' ? f.beat!.camera[f.index!].outFrames / 30 : 0; // a zoom's span includes its zoom-out
			if (mo.edge === 'end') return [{ op: 'set_time', id: mo.item_id, end: (t ?? sp.end + (mo.delta ?? 0)) + (mo.to ? outPad : 0) }];
			if (mo.edge === 'start') return [{ op: 'set_time', id: mo.item_id, start: t ?? sp.start + (mo.delta ?? 0) }];
			return [{ op: 'set_time', id: mo.item_id, start: t ?? sp.start + (mo.delta ?? 0) }];
		}
	}
	throw new Error(`I don't know how to do “${mo.op}”`);
}

void segments;

export async function assistant(a: AssistantArgs): Promise<AssistantReply> {
	const ctx = loadContext(a.dir);
	const t0 = Date.now();
	const g = grammar(a, ctx);
	if (g) return { ...g, ms: Date.now() - t0 };
	return askModel(a, ctx);
}
