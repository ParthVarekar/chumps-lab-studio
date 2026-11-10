/**
 * Project media and project creation (the Premiere-style "Project panel" and "New Project" dialog, server side).
 *
 * A project is a folder under the studio's projects folder; its media lives in `<project>/media/`. Files arrive by upload
 * (streamed to disk, never held in memory), are probed with ffprobe, and get a poster thumbnail from ffmpeg. Only known
 * media extensions are accepted and names are sanitised, so a page can never write outside the project's media folder.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { Edd, EDD_VERSION } from '@cls/engine/src/edd/schema';

export type MediaKind = 'video' | 'image' | 'audio';
export interface MediaItem {
	name: string;
	path: string; // project-relative, e.g. media/clip.mp4
	kind: MediaKind;
	size: number;
	duration: number | null;
	width: number | null;
	height: number | null;
	fps: number | null;
	hasAudio: boolean;
	thumb: string | null; // project-relative poster, or null
	modified: number;
}

const EXT: Record<MediaKind, string[]> = {
	video: ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
	image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'],
	audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
};
export const kindOf = (file: string): MediaKind | null => {
	const e = path.extname(file).toLowerCase();
	return (Object.keys(EXT) as MediaKind[]).find((k) => EXT[k].includes(e)) ?? null;
};
export const ACCEPT = Object.values(EXT).flat();

/** Top-level files of media/ only: the library folders (sfx, icons, memes) and the thumbnail cache are not "your media". */
const THUMBS = '_thumbs';

export const sanitizeName = (raw: string): string => {
	const base = path.basename(String(raw)).normalize('NFKC').replace(/[^\p{L}\p{N}._ ()-]+/gu, '_').replace(/^\.+/, '').trim().slice(0, 120);
	return base || 'media';
};

const probeCache = new Map<string, Omit<MediaItem, 'name' | 'path' | 'thumb' | 'modified' | 'size'>>();

function probe(file: string, kind: MediaKind) {
	const st = statSync(file);
	const key = `${file}|${st.size}|${st.mtimeMs}`;
	const hit = probeCache.get(key);
	if (hit) return hit;
	const out = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', maxBuffer: 8e6 });
	let duration: number | null = null, width: number | null = null, height: number | null = null, fps: number | null = null, hasAudio = false;
	try {
		const j = JSON.parse(out.stdout || '{}') as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; disposition?: { attached_pic?: number } }[] };
		const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
		hasAudio = !!j.streams?.some((s) => s.codec_type === 'audio');
		if (v) {
			width = v.width ?? null;
			height = v.height ?? null;
			const [a, b] = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
			fps = b ? Math.round((a / b) * 100) / 100 : null;
		}
		const d = Number(j.format?.duration ?? v?.duration);
		duration = Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null;
	} catch { /* leave unknowns as null */ }
	const res = { kind, duration: kind === 'image' ? null : duration, width, height, fps: kind === 'video' ? fps : null, hasAudio: kind === 'video' ? hasAudio : kind === 'audio' };
	probeCache.set(key, res);
	return res;
}

function thumb(dir: string, name: string, kind: MediaKind, duration: number | null): string | null {
	if (kind === 'audio') return null;
	const rel = `media/${THUMBS}/${name}.jpg`;
	const out = path.join(dir, rel);
	const src = path.join(dir, 'media', name);
	if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return rel;
	if (name.toLowerCase().endsWith('.svg')) return `media/${name}`; // the browser draws SVG itself
	mkdirSync(path.dirname(out), { recursive: true });
	const at = kind === 'video' ? Math.min(1, (duration ?? 2) / 3) : 0;
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...(at ? ['-ss', at.toFixed(2)] : []), '-i', src, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out]);
	return r.status === 0 && existsSync(out) ? rel : null;
}

export function listMedia(dir: string): MediaItem[] {
	const folder = path.join(dir, 'media');
	if (!existsSync(folder)) return [];
	const items: MediaItem[] = [];
	for (const e of readdirSync(folder, { withFileTypes: true })) {
		if (!e.isFile()) continue;
		const kind = kindOf(e.name);
		if (!kind) continue;
		const file = path.join(folder, e.name);
		const st = statSync(file);
		const p = probe(file, kind);
		items.push({ name: e.name, path: `media/${e.name}`, size: st.size, thumb: thumb(dir, e.name, kind, p.duration), modified: st.mtimeMs, ...p });
	}
	return items.sort((a, b) => b.modified - a.modified);
}

export function deleteMedia(dir: string, name: string) {
	const file = path.join(dir, 'media', sanitizeName(name));
	if (!path.resolve(file).startsWith(path.resolve(dir, 'media') + path.sep) || !existsSync(file)) throw new Error('no such file');
	rmSync(file, { force: true });
	rmSync(path.join(dir, 'media', THUMBS, `${path.basename(file)}.jpg`), { force: true });
}

/** A name that does not collide: "clip.mp4", "clip (2).mp4", "clip (3).mp4"… */
export function uniqueName(dir: string, wanted: string): string {
	const folder = path.join(dir, 'media');
	const ext = path.extname(wanted);
	const stem = wanted.slice(0, wanted.length - ext.length);
	let name = wanted, n = 2;
	while (existsSync(path.join(folder, name))) name = `${stem} (${n++})${ext}`;
	return name;
}

/** Stream an uploaded file straight into media/ (a temp name first, so a cancelled upload never leaves half a file). */
export function receiveUpload(dir: string, rawName: string, req: IncomingMessage): Promise<MediaItem> {
	const clean = sanitizeName(rawName);
	if (!kindOf(clean)) return Promise.reject(new Error(`that file type is not supported (allowed: ${ACCEPT.join(' ')})`));
	const folder = path.join(dir, 'media');
	mkdirSync(folder, { recursive: true });
	const name = uniqueName(dir, clean);
	const tmp = path.join(folder, `.upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	return new Promise((resolve, reject) => {
		const ws = createWriteStream(tmp);
		const fail = (e: Error) => { ws.destroy(); rmSync(tmp, { force: true }); reject(e); };
		req.on('error', fail);
		req.on('aborted', () => fail(new Error('upload cancelled')));
		ws.on('error', fail);
		ws.on('finish', () => {
			try {
				renameSync(tmp, path.join(folder, name));
				const kind = kindOf(name)!;
				const file = path.join(folder, name);
				const p = probe(file, kind);
				resolve({ name, path: `media/${name}`, size: statSync(file).size, thumb: thumb(dir, name, kind, p.duration), modified: statSync(file).mtimeMs, ...p });
			} catch (e) { fail(e as Error); }
		});
		req.pipe(ws);
	});
}

// ------------------------------------------------------------------ new projects
export const SEQUENCE_LIMITS = { width: [16, 7680], height: [16, 4320], fps: [1, 120] } as const;
export interface NewProjectArgs { name: string; width?: number; height?: number; fps?: number; seconds?: number }

export const projectSlug = (name: string) => name.normalize('NFKC').trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Create `<projects>/<name>/` with an empty sequence (one black placeholder beat that the first footage replaces). */
export function createProject(projectsRoot: string, a: NewProjectArgs): string {
	const slug = projectSlug(a.name);
	if (!slug || slug.startsWith('_')) throw new Error('give the project a name (letters, numbers, spaces)');
	const dir = path.join(projectsRoot, slug);
	if (existsSync(dir)) throw new Error(`a project called "${slug}" already exists`);
	const clamp = (v: number | undefined, d: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? (v as number) : d)));
	const format = { width: clamp(a.width, 1920, SEQUENCE_LIMITS.width), height: clamp(a.height, 1080, SEQUENCE_LIMITS.height), fps: clamp(a.fps, 30, SEQUENCE_LIMITS.fps) };
	const seconds = Math.min(600, Math.max(2, Number(a.seconds) || 10));
	const edd = Edd.parse({
		version: EDD_VERSION,
		componentLibrary: 'cls-motion@0.3.0',
		format,
		look: 'footage-first',
		audio: { sfx: [] },
		markers: [],
		beats: [{ id: 'b1', start: 0, end: seconds, base: { kind: 'color', color: '#000000' }, camera: [], layers: [], moods: [], meta: { origin: 'user', locked: false, reason: 'empty sequence' } }],
	});
	mkdirSync(path.join(dir, 'media'), { recursive: true });
	writeFileSync(path.join(dir, 'edd.json'), JSON.stringify(edd, null, 1));
	writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ name: a.name.trim(), created: new Date().toISOString(), settings: format, sources: [], narration: null, script: null }, null, 1));
	return dir;
}
