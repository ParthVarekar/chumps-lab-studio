/**
 * A 20-second document showing every technical component, for visual review.
 *   npx tsx scripts/samples/make-tech-demo.ts && npm run render -- D:\ChumpsLabStudio\projects\demo-tech\edd.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPONENT_LIBRARY } from '../../src/components/registry';
import { Edd } from '../../src/edd/schema';

const dir = join(process.env.CLS_STUDIO_ROOT ?? 'D:\\ChumpsLabStudio', 'projects', 'demo-tech');
mkdirSync(dir, { recursive: true });
const bg = { kind: 'color' as const, color: '#0E1013' };

const edd = Edd.parse({
	version: 1,
	componentLibrary: COMPONENT_LIBRARY,
	format: { width: 1920, height: 1080, fps: 30 },
	look: 'footage-first',
	audio: {},
	beats: [
		{
			id: 'code', start: 0, end: 4, base: bg,
			layers: [{
				id: 'cpp', component: 'CodeBlock', box: { x: 18, y: 14, w: 64, h: 72 }, enter: { at: 0.2, preset: 'scale-in', durationFrames: 10 },
				props: { title: 'hello.cpp', language: 'cpp', highlightLines: [5], code: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello from Linux" << endl;  // prints once\n    return 0;\n}' },
			}],
		},
		{
			id: 'term', start: 4, end: 8, base: bg,
			layers: [{
				id: 'sh', component: 'Terminal', box: { x: 16, y: 18, w: 68, h: 64 }, enter: { at: 0.2, preset: 'pop', durationFrames: 8 },
				props: { prompt: 'parth@zorin:~$', command: 'sudo snap install code --classic', output: ['code 1.106 from Visual Studio Code (vscode) installed'] },
			}],
		},
		{
			id: 'bars', start: 8, end: 12, base: bg,
			layers: [{
				id: 'bench', component: 'BarChart', box: { x: 16, y: 16, w: 68, h: 68 }, enter: { at: 0.2, preset: 'slide', direction: 'up', durationFrames: 8 },
				props: { title: 'Boot time (seconds, lower is better)', unit: ' s', decimals: 1, highlight: 'Zorin OS', bars: [
					{ label: 'Windows 11', value: 21.4 }, { label: 'Ubuntu 24.04', value: 14.2 }, { label: 'Zorin OS', value: 11.8 }, { label: 'Arch', value: 8.9 },
				] },
			}],
		},
		{
			id: 'gauge', start: 12, end: 16, base: bg,
			layers: [{
				id: 'gpu', component: 'Gauge', box: { x: 33, y: 12, w: 34, h: 76 }, enter: { at: 0.2, preset: 'pop', durationFrames: 8 },
				props: { value: 87, max: 100, redlineFrom: 80, label: 'GPU usage', unit: '%' },
			}],
		},
		{
			id: 'nn', start: 16, end: 20, base: bg,
			layers: [{
				id: 'net', component: 'NeuralNet', box: { x: 14, y: 12, w: 72, h: 76 }, enter: { at: 0.1, preset: 'fade', durationFrames: 6 },
				props: { layers: [4, 6, 6, 2], labels: ['input', 'hidden', 'hidden', 'output'], pulses: 2 },
			}],
		},
	],
});
writeFileSync(join(dir, 'edd.json'), JSON.stringify(edd, null, 1));
console.log(`wrote ${join(dir, 'edd.json')}`);
