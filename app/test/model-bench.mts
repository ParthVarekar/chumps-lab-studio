// Which free model makes the best elements? Runs the REAL element designer prompt and checks against each model, one attempt per brief,
// with no fallback (so a refusal or bad answer is the model's own result, not hidden by a backup). Saves every spec for a visual look.
//   node ../node_modules/tsx/dist/cli.mjs test/model-bench.mts <out-dir> [model1,model2,...] [--reasoning low] [--briefs rocket,chart]
// Costs one free-tier request per model per brief (default 9 models x 3 briefs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatJson } from '../server/llm';
import { messagesFor, situation, verify } from '../server/elements';
import { expandedCount, type ElementSpec, type NodeSpec } from '@cls/engine/src/element/spec';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: model-bench.mts <out-dir> [models]');
mkdirSync(OUT, { recursive: true });

const flag = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const REASON = flag('--reasoning') ? { effort: flag('--reasoning') as 'low' } : { enabled: false }; // some endpoints make reasoning mandatory
const ONLY_BRIEFS = flag('--briefs')?.split(',') ?? null;
const MODELS = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3].split(',') : [
	'nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
	'dots-studio/dots-3-note-preview:free', 'recursive/flint-v1.0:free', 'cohere/north-mini-code:free', 'liquid/lfm-3-1.7b:free', 'liquid/lfm-2.5-2.6b:free',
]);

const DIR = 'D:/ChumpsLabStudio/projects/showcase';
const region = { x: 66, y: 22, w: 22, h: 39 };
const BRIEFS: { id: string; brief: string; fits: (s: ElementSpec) => number }[] = [
	{ id: 'rocket', brief: 'a small rocket with a flickering flame', fits: (s) => {
		const all = flat(s.nodes);
		const kinds = new Set(all.map((n) => n.type));
		const flicker = all.some((n) => (n.anim ?? []).some((a) => a.kind === 'flicker' || a.kind === 'sin' || a.kind === 'pulse'));
		return (kinds.size >= 3 ? 8 : kinds.size * 2) + (flicker ? 7 : 0);
	} },
	{ id: 'chart', brief: 'a three-bar chart with a caption', fits: (s) => {
		const all = flat(s.nodes);
		const bars = all.filter((n) => n.type === 'rect').reduce((k, n) => k + (n.repeat ? 3 : 1), 0);
		const text = all.some((n) => n.type === 'text');
		const own = s.params.filter((p) => p.type === 'number').length >= 2 || all.some((n) => n.repeat);
		return (bars >= 4 ? 7 : 2) + (text ? 4 : 0) + (own ? 4 : 0);
	} },
	{ id: 'stack3d', brief: 'a 3D stack of three layers labelled App, API and Database', fits: (s) => {
		const sc = flat(s.nodes).find((n) => n.type === 'scene3d');
		if (!sc) return 0;
		const labels = (sc.objects ?? []).filter((o) => o.shape === 'label').map((o) => String(o.text ?? '').toLowerCase()).join(' ');
		const boxes = (sc.objects ?? []).filter((o) => o.shape !== 'label' && o.shape !== 'line').length;
		return 4 + (boxes >= 3 ? 3 : 0) + ['app', 'api', 'database'].filter((w) => labels.includes(w)).length * 2;
	} },
];
function flat(ns: NodeSpec[]): NodeSpec[] { return ns.flatMap((n) => [n, ...flat(n.children ?? [])]); }

interface Result { model: string; brief: string; ok: boolean; json: boolean; ms: number; errors: string[]; warns: number; shapes: number; params: number; fits: number; score: number }
const results: Result[] = [];

for (const model of MODELS) {
	for (const b of BRIEFS.filter((x) => !ONLY_BRIEFS || ONLY_BRIEFS.includes(x.id))) {
		const args = { dir: DIR, brief: b.brief, region, time: 38, duration: 4 };
		const messages = messagesFor(args, situation(args));
		const t0 = Date.now();
		let text = '', err = '';
		try {
			text = await chatJson(messages, { schemaName: 'element', schema: {}, mode: 'json', model, backup: model, maxTokens: 6000, temperature: 0.35, reasoning: REASON, timeoutMs: 120000, fallback: false });
		} catch (e) { err = e instanceof Error ? e.message.slice(0, 120) : String(e); }
		const ms = Date.now() - t0;
		let json = false, spec: ElementSpec | undefined, issues: { level: string; message: string }[] = [];
		if (text) { try { const o = JSON.parse(text); json = true; const v = verify(o.spec ?? o); spec = v.spec; issues = v.issues; } catch { /* not JSON */ } }
		const errors = issues.filter((i) => i.level === 'error').map((i) => i.message.slice(0, 90));
		if (!text) errors.push(err || 'no answer');
		else if (!json) errors.push('answer was not JSON');
		const warns = issues.filter((i) => i.level === 'warn').length;
		const ok = !!spec && !errors.length;
		const shapes = spec ? expandedCount(spec) : 0;
		const params = spec?.params.length ?? 0;
		const fits = ok && spec ? b.fits(spec) : 0;
		// 100 points: valid (50), clean (15), enough parts (10), sensible settings (10), fits this brief (15)
		const score = ok ? 50 + Math.max(0, 15 - warns * 5) + Math.min(10, shapes * 1.5) + (params >= 2 && params <= 5 ? 10 : params ? 5 : 0) + fits : 0;
		results.push({ model, brief: b.id, ok, json, ms, errors, warns, shapes, params, fits, score });
		if (spec) writeFileSync(`${OUT}/${model.replace(/[/:]/g, '_')}__${b.id}.json`, JSON.stringify(spec, null, 1));
		console.log(`${ok ? 'OK  ' : 'FAIL'} ${model.padEnd(52)} ${b.id.padEnd(8)} ${(ms / 1000).toFixed(1).padStart(5)}s score ${String(Math.round(score)).padStart(3)} ${ok ? '' : '| ' + errors[0]}`);
		await new Promise((r) => setTimeout(r, 500));
	}
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log('\n=== average per model (3 briefs) ===');
const by = MODELS.map((m) => { const r = results.filter((x) => x.model === m); return { m, valid: r.filter((x) => x.ok).length, score: r.reduce((s, x) => s + x.score, 0) / r.length, ms: r.reduce((s, x) => s + x.ms, 0) / r.length }; }).sort((a, b) => b.score - a.score);
for (const x of by) console.log(`${x.m.padEnd(52)} valid ${x.valid}/3  score ${x.score.toFixed(1).padStart(5)}  avg ${(x.ms / 1000).toFixed(1)}s`);
process.exit(0);
