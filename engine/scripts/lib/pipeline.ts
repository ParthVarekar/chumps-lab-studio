/**
 * Render pipeline (blueprint §3.3 "content-hash caching"):
 *   EDD → per-beat renders (video only, cached by content hash) → lossless concat → narration mux.
 * Changing one beat re-renders one beat.
 */
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Edd, type Beat } from '../../src/edd/schema';
import { beatFrameRange } from '../../src/edd/timing';
import { fileFingerprint, hashTree, sha256, stableStringify } from './hash';
import { startMediaServer } from './media-server';

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUDIO_ROOT = process.env.CLS_STUDIO_ROOT ?? 'D:\\ChumpsLabStudio';

export interface RenderOptions {
	eddPath: string;
	out?: string;
	scale?: number;
	concurrency?: number;
	/** NVENC via Remotion's hardwareAcceleration; otherwise libx264. */
	hw?: boolean;
	useCache?: boolean;
	jpegQuality?: number;
	x264Preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
	crf?: number;
	videoBitrate?: string;
	/** Render only these beat indices (benchmarks); skips the audio mux. */
	beats?: number[];
	cacheDir?: string;
	quiet?: boolean;
}

export interface BeatReport {
	id: string;
	frames: number;
	cached: boolean;
	seconds: number;
	fps: number;
	file: string;
}

export interface RenderReport {
	output: string;
	width: number;
	height: number;
	encoder: string;
	concurrency: number;
	totalFrames: number;
	renderedFrames: number;
	bundleSeconds: number;
	beatsSeconds: number;
	concatSeconds: number;
	totalSeconds: number;
	renderFps: number;
	beats: BeatReport[];
}

const ffmpeg = (args: string[]) => {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

/** Bundle the engine once per source version; reuse it across renders. */
export const getBundle = async (quiet = false) => {
	const engineHash = hashTree(join(ENGINE_DIR, 'src'), join(ENGINE_DIR, 'public')).slice(0, 16);
	const outDir = join(STUDIO_ROOT, 'cache', 'bundles', engineHash);
	if (!existsSync(join(outDir, 'index.html'))) {
		if (!quiet) console.log(`bundling engine ${engineHash}…`);
		await bundle({ entryPoint: join(ENGINE_DIR, 'src', 'index.ts'), outDir, publicDir: join(ENGINE_DIR, 'public') });
	}
	return { serveUrl: outDir, engineHash };
};

/** Media files a beat depends on (base footage + any layer prop named src). */
const beatAssets = (beat: Beat): string[] => {
	const out: string[] = [];
	if ('src' in beat.base) out.push(beat.base.src);
	for (const l of beat.layers) if (typeof l.props.src === 'string') out.push(l.props.src);
	return out;
};

export const renderEdd = async (opts: RenderOptions): Promise<RenderReport> => {
	const t0 = performance.now();
	const eddPath = resolve(opts.eddPath);
	const projectDir = dirname(eddPath);
	const edd = Edd.parse(JSON.parse(readFileSync(eddPath, 'utf8')));
	const { fps } = edd.format;
	const scale = opts.scale ?? 1;
	const width = Math.round(edd.format.width * scale);
	const height = Math.round(edd.format.height * scale);
	const concurrency = opts.concurrency ?? 6;
	const hw = opts.hw ?? false;
	const encoderTag = hw ? `nvenc-${opts.videoBitrate ?? '16M'}` : `x264-${opts.x264Preset ?? 'veryfast'}-crf${opts.crf ?? 18}`;
	const cacheDir = opts.cacheDir ?? join(projectDir, 'cache', 'beats');
	mkdirSync(cacheDir, { recursive: true });
	const log = (...a: unknown[]) => { if (!opts.quiet) console.log(...a); };

	const tb = performance.now();
	const { serveUrl, engineHash } = await getBundle(opts.quiet);
	const bundleSeconds = (performance.now() - tb) / 1000;

	const media = await startMediaServer(projectDir);
	const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' } });
	const indices = opts.beats ?? edd.beats.map((_, i) => i);
	const reports: BeatReport[] = [];
	const tBeats = performance.now();
	try {
		for (const i of indices) {
			const beat = edd.beats[i];
			const { durationInFrames } = beatFrameRange(beat, fps);
			const key = sha256(
				stableStringify({
					engineHash,
					lib: edd.componentLibrary,
					format: edd.format,
					look: edd.look,
					durationInFrames,
					beat: { ...beat, start: undefined, end: undefined, meta: undefined },
					assets: beatAssets(beat).map((a) => [a, fileFingerprint(join(projectDir, a))]),
				}),
			).slice(0, 20);
			const file = join(cacheDir, `${key}-${width}x${height}-${encoderTag}.mp4`);
			if (opts.useCache !== false && existsSync(file)) {
				reports.push({ id: beat.id, frames: durationInFrames, cached: true, seconds: 0, fps: 0, file });
				log(`  ${beat.id.padEnd(10)} ${String(durationInFrames).padStart(5)} frames  cached`);
				continue;
			}
			const inputProps = { edd, assetBase: media.url, beatIndex: i };
			const tr = performance.now();
			const composition = await selectComposition({ serveUrl, id: 'EddBeat', inputProps, puppeteerInstance: browser, logLevel: 'error' });
			const tmp = `${file}.part.mp4`;
			await renderMedia({
				composition,
				serveUrl,
				codec: 'h264',
				outputLocation: tmp,
				inputProps,
				muted: true,
				scale,
				concurrency,
				imageFormat: 'jpeg',
				jpegQuality: opts.jpegQuality ?? 90,
				pixelFormat: 'yuv420p',
				hardwareAcceleration: hw ? 'required' : 'disable',
				...(hw ? { videoBitrate: opts.videoBitrate ?? '16M' } : { crf: opts.crf ?? 18, x264Preset: opts.x264Preset ?? 'veryfast' }),
				chromiumOptions: { gl: 'angle' },
				puppeteerInstance: browser,
				logLevel: 'error',
			});
			renameSync(tmp, file);
			const seconds = (performance.now() - tr) / 1000;
			reports.push({ id: beat.id, frames: durationInFrames, cached: false, seconds, fps: durationInFrames / seconds, file });
			log(`  ${beat.id.padEnd(10)} ${String(durationInFrames).padStart(5)} frames  ${seconds.toFixed(1)} s  (${(durationInFrames / seconds).toFixed(1)} fps)`);
		}
	} finally {
		await browser.close({ silent: true });
		await media.close();
	}
	const beatsSeconds = (performance.now() - tBeats) / 1000;

	// Concatenate beats without re-encoding, then lay the narration over the whole timeline.
	const tc = performance.now();
	const output = resolve(opts.out ?? join(projectDir, 'renders', `${basename(eddPath, '.json')}-${height}p-${encoderTag}.mp4`));
	mkdirSync(dirname(output), { recursive: true });
	const list = `${output}.concat.txt`;
	writeFileSync(list, reports.map((r) => `file '${r.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
	const voice = edd.audio.voice;
	if (voice && !opts.beats) {
		const silent = `${output}.video.mp4`;
		ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
		const delayMs = Math.round(voice.start * 1000);
		// Sound effects are mixed in at volumes relative to the narration, and the mix is normalised to -14 LUFS once. Missing files are skipped with a warning, not fatal.
		const sfx = edd.audio.sfx.filter((c) => {
			const ok = existsSync(join(projectDir, c.src));
			if (!ok) console.warn(`sfx ${c.id}: ${c.src} not found, skipped`);
			return ok;
		});
		const total = edd.beats[edd.beats.length - 1].end;
		const inputs = ['-i', silent, '-ss', String(voice.from), '-i', join(projectDir, voice.src), ...sfx.flatMap((c) => ['-i', join(projectDir, c.src)])];
		const parts = [`[1:a]${delayMs ? `adelay=${delayMs}:all=1,` : ''}volume=${voice.volume},acompressor=threshold=0.09:ratio=3:attack=5:release=120:makeup=1,aresample=48000,apad=whole_dur=${total}[v]`]; // padded to exactly the video's length: a bare apad is endless and can hang the mux
		sfx.forEach((c, k) => parts.push(`[${k + 2}:a]aresample=48000,adelay=${Math.round(c.at * 1000)}:all=1,volume=${c.volume}[s${k}]`));
		const mixed = sfx.length
			? `[v]${sfx.map((_, k) => `[s${k}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:normalize=0:dropout_transition=0`
			: '[v]anull';
		// YouTube plays everything at about -14 LUFS. Two passes: measure the whole mix, then apply the exact gain
		// (a single dynamic pass undershot: -16.1 LUFS measured on the first render with sound effects).
		const graph = (ln: string) => [...parts, `${mixed},${ln},aresample=48000[a]`].join(';');
		const measure = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...inputs, '-t', String(total), '-filter_complex',
			graph('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json'), '-map', '[a]', '-f', 'null', '-'], { encoding: 'utf8' });
		const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(measure.stderr ?? '')?.[0];
		// loudnorm in linear mode refuses to reach -14 LUFS when the true-peak ceiling is in the way (speech peaks high,
		// effects add more): measured -15.4 LUFS. So apply the exact gain, then a soft limiter catches the peaks.
		let ln = 'loudnorm=I=-14:TP=-1.5:LRA=11';
		if (json) {
			const m = JSON.parse(json) as Record<string, string>;
			const gain = -14 - Number(m.input_i);
			if (Number.isFinite(gain)) ln = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.7:attack=5:release=60:level=false`;
		}
		ffmpeg([
			...inputs,
			'-filter_complex', graph(ln),
			'-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-shortest', '-movflags', '+faststart', output,
		]);
		rmSync(silent);
	} else {
		ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output]);
	}
	rmSync(list);
	const concatSeconds = (performance.now() - tc) / 1000;

	const totalFrames = reports.reduce((s, r) => s + r.frames, 0);
	const renderedFrames = reports.filter((r) => !r.cached).reduce((s, r) => s + r.frames, 0);
	const totalSeconds = (performance.now() - t0) / 1000;
	const report: RenderReport = {
		output, width, height, encoder: encoderTag, concurrency, totalFrames, renderedFrames,
		bundleSeconds, beatsSeconds, concatSeconds, totalSeconds,
		renderFps: renderedFrames / Math.max(beatsSeconds, 1e-6),
		beats: reports,
	};
	writeFileSync(`${output}.report.json`, JSON.stringify(report, null, 1));
	return report;
};
