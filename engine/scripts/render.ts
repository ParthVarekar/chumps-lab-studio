/**
 * Render an EDD to MP4.
 *   npm run render -- <project>\edd.json [--out file.mp4] [--scale 0.6667] [--concurrency 6] [--hw] [--no-cache]
 */
import { parseArgs } from 'node:util';
import { renderEdd } from './lib/pipeline';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string' },
		scale: { type: 'string', default: '1' },
		concurrency: { type: 'string', default: '6' },
		hw: { type: 'boolean', default: false },
		'no-cache': { type: 'boolean', default: false },
		bitrate: { type: 'string', default: '16M' },
	},
});
if (!positionals[0]) {
	console.error('usage: npm run render -- <edd.json> [--out file] [--scale 1] [--concurrency 6] [--hw] [--no-cache]');
	process.exit(2);
}

const report = await renderEdd({
	eddPath: positionals[0],
	out: values.out,
	scale: Number(values.scale),
	concurrency: Number(values.concurrency),
	hw: values.hw,
	useCache: !values['no-cache'],
	videoBitrate: values.bitrate,
});
console.log(
	`\n${report.output}\n${report.width}x${report.height} ${report.encoder} | ${report.totalFrames} frames, ${report.renderedFrames} rendered ` +
		`in ${report.beatsSeconds.toFixed(1)} s (${report.renderFps.toFixed(1)} fps) | bundle ${report.bundleSeconds.toFixed(1)} s, ` +
		`concat+mux ${report.concatSeconds.toFixed(1)} s, total ${report.totalSeconds.toFixed(1)} s`,
);
