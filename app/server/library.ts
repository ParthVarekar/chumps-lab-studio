/** The asset libraries (sound effects, stickers, logos) as the server uses them: pick one, copy it into the project, make a command. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Op } from '../shared/ops';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const LIB = path.join(process.env.CLS_STUDIO_ROOT || 'D:\\ChumpsLabStudio', 'library');

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

export interface SfxEntry { id: string; role: string; file: string; duration: number }
export interface StickerEntry { id: string; file: string; tags: string[]; credit: string; sound?: string }

export const sfxCatalog = (): SfxEntry[] => readJson(path.join(LIB, 'sfx', 'catalog.json')) ?? [];
export const memeCatalog = (): { memes: StickerEntry[]; sounds: Record<string, { file: string }> } => readJson(path.join(LIB, 'memes', 'catalog.json')) ?? { memes: [], sounds: {} };

type IconSet = { icons: Record<string, { body: string; width?: number; height?: number }>; width: number; height: number };
let iconCache: IconSet | null = null;
export const icons = (): IconSet => {
	if (iconCache) return iconCache;
	const data = readJson(path.join(ROOT, 'node_modules', '@iconify-json', 'simple-icons', 'icons.json'));
	return (iconCache = { icons: data?.icons ?? {}, width: data?.width ?? 24, height: data?.height ?? 24 });
};
const BRAND_ALIASES: Record<string, string> = { photoshop: 'adobephotoshop', vscode: 'visualstudiocode', chatgpt: 'openai', gpt: 'openai', cpp: 'cplusplus', 'c++': 'cplusplus', windows11: 'windows', windows10: 'windows' };
export function matchIcon(brand: string): string | null {
	const k = brand.toLowerCase().replace(/[^a-z0-9+]/g, '');
	const key = BRAND_ALIASES[k] ?? k.replace(/\+/g, '');
	const all = icons().icons;
	if (all[key]) return key;
	const starts = Object.keys(all).filter((i) => i.startsWith(key));
	return starts.sort((a, b) => a.length - b.length)[0] ?? null;
}

export function copyInto(dir: string, src: string, rel: string): string {
	const dst = path.join(dir, rel, path.basename(src));
	if (!existsSync(dst)) {
		mkdirSync(path.dirname(dst), { recursive: true });
		copyFileSync(src, dst);
	}
	return `${rel}/${path.basename(src)}`.replace(/\\/g, '/');
}

/** Deterministic pick of a sound of a role (same key → same sound, so a re-run doesn't reshuffle). */
export function pickSfx(role: string, key: string): SfxEntry | null {
	const pool = sfxCatalog().filter((c) => c.role === role);
	if (!pool.length) return null;
	let h = 0;
	for (const ch of `${role}:${key}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return pool[h % pool.length];
}

export const sfxRoles = () => Array.from(new Set([...sfxCatalog().map((c) => c.role), ...Object.keys(memeCatalog().sounds)]));

/** A sound by role: a generic effect (whoosh, pop, key…) or one of the comedic meme sounds (rimshot, laugh, sad…). */
export function soundOp(dir: string, role: string, key: string, at: number, volume = 0.5, why?: string): Op | null {
	const meme = memeCatalog().sounds[role];
	if (meme) return { op: 'add_sfx', src: copyInto(dir, path.join(LIB, 'memes', meme.file), 'media/sfx'), at, volume: Math.max(volume, 0.55), role, why };
	const c = pickSfx(role, key);
	return c ? sfxOp(dir, c, at, volume, why) : null;
}

export function sfxOp(dir: string, c: SfxEntry, at: number, volume = 0.5, why?: string): Op {
	return { op: 'add_sfx', src: copyInto(dir, path.join(LIB, 'sfx', c.file), 'media/sfx'), at, volume, role: c.role, why };
}

export function stickerOp(dir: string, m: StickerEntry, at: number, why?: string): Op {
	return { op: 'add_layer', component: 'MemeSticker', at, props: { src: copyInto(dir, path.join(LIB, 'memes', m.file), 'media/memes'), credit: m.credit }, why: why ?? `sticker ${m.id}` };
}

export function iconOp(dir: string, id: string, at: number, why?: string): Op {
	const ic = icons().icons[id];
	if (!ic) throw new Error('unknown icon');
	const out = path.join(dir, 'media', 'icons');
	mkdirSync(out, { recursive: true });
	const w = ic.width ?? icons().width;
	const h = ic.height ?? icons().height;
	writeFileSync(path.join(out, `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="512" height="512">${ic.body.replace(/currentColor/g, '#FFFFFF')}</svg>`);
	return { op: 'add_layer', component: 'PopImage', at, props: { src: `media/icons/${id}.svg` }, why: why ?? `${id} logo` };
}

/** Turn a library pick (from the UI) into a command. */
export function libraryOp(dir: string, body: { kind: string; id: string; at: number }): Op {
	if (body.kind === 'sfx') {
		const c = sfxCatalog().find((x) => x.id === body.id);
		if (!c) throw new Error('unknown sound');
		return sfxOp(dir, c, body.at);
	}
	if (body.kind === 'sticker') {
		const m = memeCatalog().memes.find((x) => x.id === body.id);
		if (!m) throw new Error('unknown sticker');
		return stickerOp(dir, m, body.at);
	}
	if (body.kind === 'icon') return iconOp(dir, body.id, body.at);
	throw new Error('unknown library kind');
}
