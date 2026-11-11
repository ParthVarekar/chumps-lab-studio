/** One place for talking to the language models (OpenRouter free tier). The key comes from the git-ignored .env; it is never logged. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LIB, ROOT } from './library';

// Inkling 2 Small (free, 1M context, a reasoning model) is the primary model for everything: the assistant, the element designer, every attempt.
// Its FREE endpoint sometimes refuses ordinary API clients (HTTP 403 "only available on agentic harnesses"), and it has no response_format, so it may
// answer in prose or a code fence. Both are handled below: a refusal or an answer that is not valid JSON is retried on a backup model that does support
// response_format (Nemotron 3.5 Super VL; Nemotron 3 Ultra for the designer's last, hardest attempt), then the local models take over.
// Override with CLS_MODEL / CLS_FAST_MODEL / CLS_BIG_MODEL.
/** A chat message. `content` may mix text and pictures (OpenAI-style parts); the cloud models are multimodal, the local text models get the words only. */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: string; content: string | ContentPart[] };
const wordsOnly = (messages: ChatMessage[]) => messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('\n') }));

export const PRIMARY_MODEL = process.env.CLS_MODEL || 'thinkingmachines/inkling-2-small:free';
export const FAST_MODEL = process.env.CLS_FAST_MODEL || PRIMARY_MODEL;
export const BIG_MODEL = process.env.CLS_BIG_MODEL || PRIMARY_MODEL;
export const BACKUP_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
/** The element designer's own pick, chosen by test (app/test/model-bench.mts, 12 Nov 2026: 9 free models x 3 briefs): dots-3-note-preview was the only one valid
 *  on all 3 (about 10 s each); Nemotron 3.5 Super VL drew the best pictures but was valid 1 of 3; Nemotron 3 Ultra, Lightning, Nano Omni, North Mini Code and the
 *  Liquid / Flint models produced no valid element. Override with CLS_ELEMENT_MODEL. */
export const ELEMENT_MODEL = process.env.CLS_ELEMENT_MODEL || 'dots-studio/dots-3-note-preview:free';
export const BACKUP_BIG = BACKUP_MODEL; // Nemotron 3 Ultra was the old backup for hard jobs; it failed every element in the benchmark
/** Models OpenRouter refused (403), and until when we leave them alone. They are tried again after RESTRICTED_FOR_MS. */
const RESTRICTED_FOR_MS = 60_000; // a refusal costs ~0.1 s, so Inkling gets another chance every minute
const restricted = new Map<string, number>();
const isRestricted = (m: string) => (restricted.get(m) ?? 0) > Date.now();

export function apiKey(): string | null {
	if (process.env.CLS_OPENROUTER_API_KEY) return process.env.CLS_OPENROUTER_API_KEY;
	const f = path.join(ROOT, '.env');
	if (!existsSync(f)) return null;
	const m = /^CLS_OPENROUTER_API_KEY\s*=\s*(.+)$/m.exec(readFileSync(f, 'utf8'));
	return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

export interface ChatOptions {
	model?: string;
	schemaName: string;
	schema: unknown;
	/** 'json': just guarantee valid JSON (the caller validates). Use it when the answer is a big nested object a small model would fumble inside a schema. */
	mode?: 'schema' | 'json';
	maxTokens?: number;
	temperature?: number;
	reasoning?: { enabled?: boolean; effort?: 'low' | 'medium' | 'high'; max_tokens?: number };
	timeoutMs?: number;
	/** Model to retry on if the first refuses (403) or answers something that is not JSON. Default: Nemotron 3.5 Super VL. */
	backup?: string;
}

export const LOCAL_MODEL = process.env.CLS_LOCAL_MODEL || 'qwen3:8b';
let lastUsed = 'none';
/** Which model answered the most recent call (shown to the user: a local answer may be a bit rougher). */
export const lastProvider = () => lastUsed;

/** If Ollama is not answering, start it (hidden, detached) and wait for it. Returns whether it is up. */
let starting: Promise<boolean> | null = null;
async function ensureOllama(): Promise<boolean> {
	const up = async () => { try { return (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
	if (await up()) return true;
	starting ??= (async () => {
		try { spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref(); } catch { return false; }
		for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await up()) return true; }
		return false;
	})().finally(() => { starting = null; });
	return starting;
}

/** The local model (Ollama): free, offline, no daily limit. Used when the free cloud endpoint is out of quota or down. */
async function ollamaJson(messages: ChatMessage[], o: ChatOptions): Promise<string> {
	await ensureOllama();
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), 300000);
	try {
		const r = await fetch('http://127.0.0.1:11434/api/chat', {
			method: 'POST',
			signal: ctl.signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: LOCAL_MODEL, messages: wordsOnly(messages), stream: false, think: false, format: o.mode === 'json' ? 'json' : o.schema, options: { temperature: o.temperature ?? 0.3, num_ctx: 12288, num_predict: o.maxTokens ?? 4000 } }),
		});
		const body = (await r.json()) as { message?: { content?: string }; error?: string };
		if (!r.ok || body.error) throw new Error(body.error ?? `ollama returned ${r.status}`);
		if (!body.message?.content) throw new Error('empty answer from the local model');
		return body.message.content;
	} catch (e) {
		if (e instanceof TypeError) throw new Error('the local model is not running (start Ollama)');
		if (e instanceof Error && e.name === 'AbortError') throw new Error('the local model took too long');
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

// ------------------------------------------------------------------ local model 1: Bonsai 2 27B through PrismML's llama.cpp build
// Bonsai 2 is Qwen3.5-27B (a hybrid: 3 of 4 layers are linear-attention, so the KV cache is tiny) squeezed to ~1.4 bits per weight (5.9 GB), stored in a
// Hadamard-rotated basis. Only PrismML's llama.cpp build reads it correctly (stock llama.cpp and Ollama reject it or return gibberish). It fits wholly on the
// 8 GB GPU. The server is started on demand (hidden, detached) and left running; its log goes next to the other studio data on D:.
const LLAMA_DIR = process.env.CLS_LLAMA_DIR || 'D:/llama-prism/bin';
const LLAMA_FILE = process.env.CLS_LLAMA_MODEL || 'D:/Ollama/models/blobs/sha256-53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3';
const LLAMA_PORT = Number(process.env.CLS_LLAMA_PORT || 8089); // 8080 is taken by other software on this PC
const LLAMA_URL = `http://127.0.0.1:${LLAMA_PORT}`;
export const LLAMA_NAME = 'bonsai2-27b';
const llamaArgs = () => ['--model', LLAMA_FILE, '--alias', LLAMA_NAME, '--host', '127.0.0.1', '--port', String(LLAMA_PORT), '-c', '16384', '-b', '1024', '-ub', '512', '-np', '1', '-t', '8', '-ngl', 'all', '--fit', 'off', '-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0', '-kvo', '--load-mode', 'none', '--cache-ram', '0', '--spec-type', 'none', '--jinja', '--reasoning', 'off', '--temp', '1.0', '--top-p', '0.95', '--top-k', '20', '--min-p', '0.05'];
let llamaStarting: Promise<boolean> | null = null;
let llamaBrokenUntil = 0;
const llamaUp = async () => { try { return (await fetch(`${LLAMA_URL}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

/** Is the Bonsai server answering? If not, start it (loading 6 GB onto the GPU takes about a minute) and wait. */
async function ensureLlama(): Promise<boolean> {
	if (await llamaUp()) return true;
	if (Date.now() < llamaBrokenUntil) return false;
	const exe = path.join(LLAMA_DIR, 'llama-server.exe');
	if (!existsSync(exe) || !existsSync(LLAMA_FILE)) { llamaBrokenUntil = Date.now() + 3600_000; return false; }
	llamaStarting ??= (async () => {
		try {
			// Free the GPU first: Ollama keeps its model resident for minutes and would leave Bonsai no room.
			await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: LOCAL_MODEL, keep_alive: 0 }), signal: AbortSignal.timeout(1500) }).catch(() => undefined);
			const logDir = path.join(path.dirname(LIB), 'logs');
			mkdirSync(logDir, { recursive: true });
			const fd = openSync(path.join(logDir, 'llama-server.log'), 'a');
			const child = spawn(exe, llamaArgs(), { cwd: LLAMA_DIR, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
			let died = false;
			child.on('exit', () => { died = true; });
			child.on('error', () => { died = true; });
			child.unref();
			for (let i = 0; i < 150; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				if (await llamaUp()) return true;
				if (died) break;
			}
		} catch { /* fall through */ }
		llamaBrokenUntil = Date.now() + 10 * 60_000; // don't make every request wait for a server that will not start
		return false;
	})().finally(() => { llamaStarting = null; });
	return llamaStarting;
}

async function llamaJson(messages: ChatMessage[], o: ChatOptions): Promise<string> {
	if (!(await ensureLlama())) throw new Error('the local Bonsai server is not running and could not be started (see D:\\ChumpsLabStudio\\logs\\llama-server.log)');
	const call = async (format: unknown) => {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), o.timeoutMs && o.timeoutMs > 90000 ? o.timeoutMs : 300000);
		try {
			const r = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
				method: 'POST',
				signal: ctl.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: LLAMA_NAME, messages: wordsOnly(messages), stream: false, temperature: o.temperature ?? 0.3, max_tokens: o.maxTokens ?? 4000, response_format: format }),
			});
			const body = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
			return { ok: r.ok && !body.error, text: body.choices?.[0]?.message?.content, error: body.error?.message ?? `llama-server returned ${r.status}` };
		} finally {
			clearTimeout(timer);
		}
	};
	try {
		let res = o.mode === 'json' ? await call({ type: 'json_object' }) : await call({ type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: o.schema } });
		// A schema the grammar converter can't express: fall back to "any valid JSON"; callers validate the shape anyway.
		if (!res.ok && o.mode !== 'json') res = await call({ type: 'json_object' });
		if (!res.ok || !res.text) throw new Error(res.error || 'empty answer from the local model');
		return res.text;
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') throw new Error('the local model took too long');
		throw e;
	}
}

/** A schema-constrained chat call. Cloud first; if that fails (quota, outage, timeout) Bonsai answers locally, then Ollama as the last resort. */
export async function chatJson(messages: ChatMessage[], o: ChatOptions & { fallback?: boolean }): Promise<string> {
	try {
		const { text, model } = await cloudJson(messages, o);
		lastUsed = model;
		return text;
	} catch (cloudError) {
		if (o.fallback === false) throw cloudError;
		const why: string[] = [cloudError instanceof Error ? cloudError.message : String(cloudError)];
		try {
			const text = await llamaJson(messages, o);
			lastUsed = `${LLAMA_NAME} (local)`;
			return text;
		} catch (bonsaiError) {
			why.push(`Bonsai: ${bonsaiError instanceof Error ? bonsaiError.message : bonsaiError}`);
		}
		try {
			const text = await ollamaJson(messages, o);
			lastUsed = `${LOCAL_MODEL} (local)`;
			return text;
		} catch (localError) {
			throw new Error(`${why.join('; ')}; Ollama: ${localError instanceof Error ? localError.message : localError}`);
		}
	}
}

/** Some models (no response_format support) answer ```json { ... } ```: hand back just the JSON. */
export const unfence = (s: string): string => { const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(s); return m ? m[1] : s; };

async function cloudJson(messages: ChatMessage[], o: ChatOptions): Promise<{ text: string; model: string }> {
	const key = apiKey();
	if (!key) throw new Error('no API key (CLS_OPENROUTER_API_KEY in .env)');
	const wanted = o.model ?? FAST_MODEL;
	const backup = o.backup ?? BACKUP_MODEL;
	const post = async (model: string) => {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 90000);
		try {
			const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				signal: ctl.signal,
				headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Chumps Lab Studio', 'HTTP-Referer': 'https://github.com/ParthVarekar/chumps-lab-studio' }, // OpenRouter's own app-attribution headers, with our real name and repo
				body: JSON.stringify({
					model,
					messages,
					temperature: o.temperature ?? 0.3,
					max_tokens: o.maxTokens ?? 4000,
					reasoning: o.reasoning ?? { enabled: false },
					response_format: o.mode === 'json' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: o.schema } },
				}),
			});
			const body = (await r.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; error?: { message?: string } };
			return { r, body };
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') throw new Error('the model took too long');
			throw e;
		} finally {
			clearTimeout(timer);
		}
	};
	const answer = (res: Awaited<ReturnType<typeof post>>): string => {
		if (!res.r.ok || res.body.error) throw new Error(res.body.error?.message ?? `model returned ${res.r.status}`);
		const content = res.body.choices?.[0]?.message?.content;
		if (!content) throw new Error(`empty answer (${res.body.choices?.[0]?.finish_reason ?? 'unknown'})`);
		return unfence(content);
	};
	const isJson = (t: string) => { try { JSON.parse(t); return true; } catch { return false; } };

	let model = isRestricted(wanted) ? backup : wanted;
	let res = await post(model);
	if (res.r.status === 403 && /agentic harness/i.test(res.body.error?.message ?? '') && model !== backup) {
		restricted.set(model, Date.now() + RESTRICTED_FOR_MS); // refused as a client: leave it alone for a while and use the backup
		model = backup;
		res = await post(model);
	}
	let text: string;
	try { text = answer(res); } catch (e) {
		// An empty answer / error from the primary (e.g. it spent its whole budget reasoning): try the backup once.
		if (model === backup) throw e;
		model = backup;
		text = answer(await post(model));
	}
	if (!isJson(text) && model !== backup) {
		// No response_format on this model: it answered in prose. Ask the backup, which can be held to JSON.
		const again = await post(backup);
		try { const t2 = answer(again); if (isJson(t2)) return { text: t2, model: backup }; } catch { /* keep the first answer */ }
	}
	return { text, model };
}
