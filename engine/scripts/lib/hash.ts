import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** JSON with sorted keys, so equal documents always hash equally. */
export const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const obj = value as Record<string, unknown>;
	return `{${Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
		.join(',')}}`;
};

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Content hash of every file under the given folders (the engine's source + public assets). */
export const hashTree = (...roots: string[]): string => {
	const h = createHash('sha256');
	const walk = (dir: string, base: string) => {
		for (const name of readdirSync(dir).sort()) {
			const p = join(dir, name);
			const st = statSync(p);
			if (st.isDirectory()) walk(p, base);
			else {
				h.update(relative(base, p).replace(/\\/g, '/'));
				h.update(readFileSync(p));
			}
		}
	};
	for (const r of roots) walk(r, r);
	return h.digest('hex');
};

/**
 * Cheap fingerprint for media files (size + modification time), so a beat re-renders when its footage
 * or image changes without hashing gigabytes of video on every run.
 */
export const fileFingerprint = (path: string): string => {
	try {
		const st = statSync(path);
		return `${st.size}:${Math.round(st.mtimeMs)}`;
	} catch {
		return 'missing';
	}
};
