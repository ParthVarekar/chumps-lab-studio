// Talking to the studio server. Same API the AI uses.
import type { Edd } from '@cls/engine/src/edd/schema';
import type { Op, ApplyNote } from '../shared/ops';

export interface Word { text: string; start: number; end: number }
export interface ProjectInfo { name: string; dir: string; modified: number }
export interface Opened {
	dir: string; edd: Edd; rev: number; report: any | null; assetBase: string; history: number;
	words: Word[]; canUndo: number; canRedo: number;
}
export interface OpsResult { edd: Edd; notes: ApplyNote[]; rev: number; applied: number; dryRun: boolean; canUndo: number; canRedo: number }
export interface AssistantReply {
	reply: string;
	ops: Op[];
	options?: string[];
	source: 'grammar' | 'model' | 'none';
	via?: string; // which model answered, e.g. thinkingmachines/inkling-2-small:free
	ms?: number;
}
export interface ElementEntry { id: string; name: string; description: string; tags: string[]; spec: any; params: Record<string, unknown>; saved?: boolean }
export interface DesignReply { ok: boolean; say: string; spec?: any; params?: Record<string, unknown>; issues: { level: string; where: string; message: string }[]; ms: number; attempts: number; op?: Op | null }
export type ComponentSchemas = Record<string, { description: string; space: string; schema: { properties?: Record<string, any> } }>;
export interface SfxItem { id: string; role: string; file: string; duration: number; source: { pack: string; author: string } }
export interface Sticker { id: string; file: string; tags: string[]; credit: string }

export interface MediaItem { name: string; path: string; kind: 'video' | 'image' | 'audio'; size: number; duration: number | null; width: number | null; height: number | null; fps: number | null; hasAudio: boolean; thumb: string | null; modified: number }
export interface NewProjectArgs { name: string; width: number; height: number; fps: number; seconds?: number }

/** Upload one file with progress (fetch cannot report upload progress, XHR can). The body is the raw file, streamed to disk by the server. */
const upload = (dir: string, file: File, onProgress: (pct: number) => void): Promise<MediaItem> =>
	new Promise((resolve, reject) => {
		const x = new XMLHttpRequest();
		x.open('POST', `/api/media/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`);
		x.setRequestHeader('X-Studio', '1');
		x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
		x.onerror = () => reject(new Error('the upload failed (is the studio running?)'));
		x.onload = () => {
			let data: { error?: string } & Partial<MediaItem> = {};
			try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
			if (x.status >= 200 && x.status < 300) resolve(data as MediaItem);
			else reject(new Error(data.error ?? `upload failed (${x.status})`));
		};
		x.send(file);
	});

const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
	const r = await fetch(path, { method, headers: { 'X-Studio': '1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	const data = await r.json().catch(() => null);
	if (!r.ok) throw new Error((data as { error?: string } | null)?.error ?? `${path}: ${r.status}`);
	return data as T;
};

export const api = {
	projects: () => call<ProjectInfo[]>('GET', '/api/projects'),
	newProject: (a: NewProjectArgs) => call<{ dir: string }>('POST', '/api/projects/new', a),
	media: (dir: string) => call<{ items: MediaItem[] }>('GET', `/api/media?dir=${encodeURIComponent(dir)}`),
	deleteMedia: (dir: string, name: string) => call<{ ok: true }>('POST', '/api/media/delete', { dir, name }),
	uploadMedia: upload,
	open: (dir: string) => call<Opened>('POST', '/api/open', { dir }),
	ops: (dir: string, ops: Op[], o: { author?: 'user' | 'ai'; dryRun?: boolean; note?: string } = {}) => call<OpsResult>('POST', '/api/ops', { dir, ops, ...o }),
	undo: (dir: string) => call<{ ok: boolean; rev: number }>('POST', '/api/undo', { dir }),
	redo: (dir: string) => call<{ ok: boolean; rev: number }>('POST', '/api/redo', { dir }),
	library: () => call<{ sfx: SfxItem[]; memes: { memes: Sticker[]; sounds: Record<string, unknown> } }>('GET', '/api/library'),
	icons: (q: string) => call<{ id: string; svg: string }[]>('GET', `/api/icons?q=${encodeURIComponent(q)}`),
	addFromLibrary: (dir: string, kind: 'sfx' | 'sticker' | 'icon', id: string, at: number) => call<{ notes: ApplyNote[]; rev: number; id?: string }>('POST', '/api/library/add', { dir, kind, id, at }),
	waveform: (dir: string) => call<number[]>('GET', `/api/waveform?dir=${encodeURIComponent(dir)}`),
	render: (dir: string) => call<{ code?: number; output?: string | null; error?: string }>('POST', '/api/render', { dir }),
	replan: (dir: string) => call<{ code?: number; error?: string }>('POST', '/api/replan', { dir }),
	components: () => call<ComponentSchemas>('GET', '/api/components'),
	elements: () => call<ElementEntry[]>('GET', '/api/elements'),
	design: (b: { dir: string; brief: string; region?: unknown; time: number; duration: number }) => call<DesignReply>('POST', '/api/elements/design', b),
	refine: (b: { dir: string; spec: unknown; params: unknown; instruction: string; time: number; duration: number; region?: unknown }) => call<DesignReply>('POST', '/api/elements/refine', b),
	saveElement: (name: string, spec: unknown, params: unknown) => call<ElementEntry>('POST', '/api/elements/save', { name, spec, params }),
	assistant: (b: { dir: string; message: string; time: number; selection: string[]; region?: unknown }) => call<AssistantReply>('POST', '/api/assistant', b),
};

/** Server-sent events: document changes (from any client, including the AI) and job logs. */
export function subscribe(onEvent: (e: any) => void): () => void {
	const ctl = new AbortController();
	void (async () => {
		for (;;) {
			try {
				const r = await fetch('/api/events', { headers: { 'X-Studio': '1' }, signal: ctl.signal });
				const reader = r.body!.getReader();
				const dec = new TextDecoder();
				let buf = '';
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					let i;
					while ((i = buf.indexOf('\n\n')) >= 0) {
						const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
						buf = buf.slice(i + 2);
						if (line) onEvent(JSON.parse(line.slice(6)));
					}
				}
			} catch {
				if (ctl.signal.aborted) return;
			}
			await new Promise((r) => setTimeout(r, 1500)); // server restarted: reconnect
		}
	})();
	return () => ctl.abort();
}
