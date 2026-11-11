// Which FREE OpenRouter models can this key actually use? Sends one tiny request to each free text model and classifies the answer.
//   node ../node_modules/tsx/dist/cli.mjs test/free-models.mts [--max 40] [--only inkling,nemotron]
// Each probe counts against the free-tier daily request limit, so it first prints the allowance. The key is read from .env and never printed.
import { apiKey } from '../server/llm';

const key = apiKey();
if (!key) throw new Error('no key in .env (CLS_OPENROUTER_API_KEY)');
const args = process.argv.slice(2);
const max = Number(args[args.indexOf('--max') + 1]) || 60;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].toLowerCase().split(',') : null;
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Chumps Lab Studio', 'HTTP-Referer': 'https://github.com/ParthVarekar/chumps-lab-studio' };

const info = ((await (await fetch('https://openrouter.ai/api/v1/key', { headers: H })).json()) as any).data ?? {};
console.log(`key: free tier = ${info.is_free_tier}, usage today = ${info.usage_daily ?? info.usage ?? '?'}, limit = ${info.limit ?? 'none'}, rate limit = ${JSON.stringify(info.rate_limit ?? {})}`);

const catalogue = ((await (await fetch('https://openrouter.ai/api/v1/models')).json()) as any).data as any[];
let free = catalogue.filter((m) => m.id.endsWith(':free') && (m.architecture?.output_modalities ?? ['text']).includes('text') && (m.architecture?.output_modalities ?? ['text']).length === 1);
if (only) free = free.filter((m) => only.some((o) => m.id.toLowerCase().includes(o)));
free = free.slice(0, max);
console.log(`${free.length} free text models to probe\n`);

type Row = { id: string; status: string; ms: number; note: string; vision: boolean; tools: boolean; json: boolean; ctx: number };
const rows: Row[] = [];
for (const m of free) {
	const t0 = Date.now();
	let status = '', note = '';
	try {
		const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model: m.id, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 60 }) });
		const j = (await r.json()) as any;
		const msg: string = j.error?.message ?? '';
		if (r.ok && !j.error) { status = 'OK'; note = JSON.stringify(j.choices?.[0]?.message?.content ?? '').slice(0, 24); }
		else if (r.status === 403 && /agentic harness/i.test(msg)) { status = 'REFUSED (harness only)'; }
		else if (r.status === 429) { status = 'RATE-LIMITED'; note = msg.slice(0, 70); }
		else if (r.status === 402) { status = 'NEEDS CREDITS'; note = msg.slice(0, 60); }
		else if (r.status === 404) { status = 'NO ENDPOINT'; note = msg.slice(0, 60); }
		else { status = `HTTP ${r.status}`; note = msg.slice(0, 70); }
	} catch (e) { status = 'ERROR'; note = e instanceof Error ? e.message.slice(0, 50) : String(e); }
	const sp: string[] = m.supported_parameters ?? [];
	rows.push({ id: m.id, status, ms: Date.now() - t0, note, vision: (m.architecture?.input_modalities ?? []).includes('image'), tools: sp.includes('tools'), json: sp.includes('response_format') || sp.includes('structured_outputs'), ctx: m.context_length ?? 0 });
	console.log(`${status.padEnd(22)} ${m.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s ${note ? '| ' + note : ''}`);
	if (status === 'RATE-LIMITED' && /per-day|daily/i.test(note)) { console.log('\nDaily free-model limit reached: stopping.'); break; }
	await new Promise((r) => setTimeout(r, 400));
}
const ok = rows.filter((r) => r.status === 'OK');
console.log(`\n=== ${ok.length} of ${rows.length} free models answered ===`);
for (const r of ok.sort((a, b) => b.ctx - a.ctx)) console.log(`${r.id.padEnd(58)} ctx ${String(Math.round(r.ctx / 1000)).padStart(5)}k  ${r.vision ? 'vision ' : '       '}${r.tools ? 'tools ' : '      '}${r.json ? 'json' : ''}`);
process.exit(0);
