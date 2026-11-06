/**
 * Phase 2 benchmark (roadmap criteria): render speed by resolution, concurrency and encoder, and
 * the cost of re-rendering after a one-beat change.
 *   npm run bench -- <project>\edd.json [--out report.json]
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { renderEdd, type RenderReport } from './lib/pipeline';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
const eddPath = resolve(positionals[0] ?? '');
const projectDir = dirname(eddPath);
const benchDir = join(projectDir, 'cache', 'bench');
rmSync(benchDir, { recursive: true, force: true });
mkdirSync(benchDir, { recursive: true });

const rows: Record<string, unknown>[] = [];
const run = async (label: string, opts: Parameters<typeof renderEdd>[0]): Promise<RenderReport> => {
	const r = await renderEdd({ quiet: true, ...opts });
	const row = {
		label, resolution: `${r.width}x${r.height}`, encoder: r.encoder, concurrency: r.concurrency,
		frames: r.renderedFrames, seconds: +r.beatsSeconds.toFixed(1), fps: +r.renderFps.toFixed(1), totalSeconds: +r.totalSeconds.toFixed(1),
	};
	rows.push(row);
	console.log(JSON.stringify(row));
	return r;
};

// 1. Concurrency sweep at 720p on the first two beats (~22 s of video), x264.
for (const c of [2, 4, 6, 8]) {
	await run(`720p c${c}`, { eddPath, scale: 2 / 3, concurrency: c, beats: [0, 1], useCache: false, cacheDir: join(benchDir, `sweep-${c}`) });
}
const best = rows.reduce((a, b) => ((b.fps as number) > (a.fps as number) ? b : a));
const bestC = best.concurrency as number;
console.log(`best concurrency: ${bestC}`);

// 2. Full 60 s at 1080p: x264 vs NVENC, at the best concurrency.
const full1080 = await run('1080p x264 full', { eddPath, concurrency: bestC, useCache: false, cacheDir: join(benchDir, 'x264'), out: join(benchDir, 'full-x264.mp4') });
await run('1080p nvenc full', { eddPath, concurrency: bestC, hw: true, useCache: false, cacheDir: join(benchDir, 'nvenc'), out: join(benchDir, 'full-nvenc.mp4') });
await run('720p x264 full', { eddPath, scale: 2 / 3, concurrency: bestC, useCache: false, cacheDir: join(benchDir, 'x264-720'), out: join(benchDir, 'full-720.mp4') });

// 3. Change one beat (a title's text) and re-render with the cache from the x264 run.
const edited = JSON.parse(readFileSync(eddPath, 'utf8'));
const beat = edited.beats.find((b: { layers: { component: string }[] }) => b.layers.some((l) => l.component === 'Title'));
beat.layers.find((l: { component: string }) => l.component === 'Title').props.text = 'make it yours';
const editedPath = join(projectDir, 'edd.bench-edited.json');
writeFileSync(editedPath, JSON.stringify(edited, null, 1));
const rerender = await run('1080p x264 one beat changed', { eddPath: editedPath, concurrency: bestC, cacheDir: join(benchDir, 'x264'), out: join(benchDir, 'edited.mp4') });
rmSync(editedPath);

const summary = {
	date: new Date().toISOString(),
	machine: 'Core 7 240H, RTX 5050 Laptop 8 GB, 24 GB RAM, Windows 11',
	rows,
	bestConcurrency: bestC,
	oneBeatChange: {
		fullSeconds: +full1080.totalSeconds.toFixed(1),
		rerenderSeconds: +rerender.totalSeconds.toFixed(1),
		ratio: +(rerender.totalSeconds / full1080.totalSeconds).toFixed(3),
		reRenderedBeats: rerender.beats.filter((b) => !b.cached).map((b) => b.id),
	},
};
const out = values.out ?? join(benchDir, 'benchmark.json');
writeFileSync(out, JSON.stringify(summary, null, 1));
copyFileSync(out, join(benchDir, 'benchmark.latest.json'));
console.log(`\n${JSON.stringify(summary.oneBeatChange)}\nwrote ${out}`);
