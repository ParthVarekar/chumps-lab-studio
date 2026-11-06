/**
 * Ready-made animated elements in the house style (flat, bold, white-outlined text, yellow accent), written in the
 * element spec format. They are what you pick from the gallery AND the worked examples the AI generator learns from.
 * Each one has its own settings (params): what to configure is part of the design.
 */
import { ElementSpec } from './spec';

export interface Preset { id: string; name: string; tags: string[]; description: string; spec: ElementSpec }

const num = (key: string, label: string, def: number, min: number, max: number, step = 1) => ({ key, label, type: 'number' as const, default: def, min, max, step });

const raw: { id: string; tags: string[]; spec: unknown }[] = [
	{
		id: 'speedometer',
		tags: ['gauge', 'dial', 'speed', 'cpu', 'usage', 'performance', 'meter', 'percent'],
		spec: {
			name: 'Speedometer', description: 'A 270-degree dial: the arc fills and the needle springs to the value, the number counts up.',
			viewBox: [200, 200],
			params: [num('value', 'Value', 72, 0, 100), num('sweep', 'Needle time (s)', 1.4, 0.3, 4, 0.1), { key: 'label', label: 'Caption', type: 'text', default: '' }],
			nodes: [
				{ type: 'circle', attrs: { cx: 100, cy: 110, r: 88, fill: 'black', opacity: 0.55 } },
				{ type: 'path', attrs: { d: 'M 50.5 159.5 A 70 70 0 1 1 149.5 159.5', fill: 'none', stroke: 'muted', strokeWidth: 12, strokeLinecap: 'round', opacity: 0.5 } },
				{ type: 'path', show: '=value<=80', attrs: { d: 'M 50.5 159.5 A 70 70 0 1 1 149.5 159.5', fill: 'none', stroke: 'accent', strokeWidth: 12, strokeLinecap: 'round' }, anim: [{ prop: 'draw', kind: 'ramp', from: 0, to: '=value/100', duration: '=sweep', ease: 'out' }] },
				{ type: 'path', show: '=value>80', attrs: { d: 'M 50.5 159.5 A 70 70 0 1 1 149.5 159.5', fill: 'none', stroke: 'accent2', strokeWidth: 12, strokeLinecap: 'round' }, anim: [{ prop: 'draw', kind: 'ramp', from: 0, to: '=value/100', duration: '=sweep', ease: 'out' }] },
				{ type: 'line', repeat: { count: 11 }, attrs: { x1: '=100+56*cos(135+i*27)', y1: '=110+56*sin(135+i*27)', x2: '=100+64*cos(135+i*27)', y2: '=110+64*sin(135+i*27)', stroke: 'text', strokeWidth: 3, strokeLinecap: 'round' } },
				{ type: 'group', origin: [100, 110], anim: [{ prop: 'rotate', kind: 'ramp', from: -135, to: '=-135+value*2.7', duration: '=sweep', ease: 'spring' }], children: [
					{ type: 'polygon', attrs: { points: '96,112 104,112 100,50', fill: 'text', stroke: 'ink', strokeWidth: 2.5, strokeLinejoin: 'round' } },
				] },
				{ type: 'circle', attrs: { cx: 100, cy: 110, r: 9, fill: 'accent', stroke: 'ink', strokeWidth: 3 } },
				{ type: 'text', text: '{{round(value*min(1,t/sweep))}}%', attrs: { x: 100, y: 150, fontSize: 30, fontFamily: 'display', fill: 'text', textAnchor: 'middle' } },
				{ type: 'text', text: '{{$label}}', attrs: { x: 100, y: 176, fontSize: 15, fontFamily: 'body', fontWeight: 800, fill: 'text', textAnchor: 'middle' } },
			],
		},
	},
	{
		id: 'wifi-pulse',
		tags: ['wifi', 'signal', 'wireless', 'network', 'internet', 'connection', 'pulse'],
		spec: {
			name: 'Wi-Fi pulse', description: 'Three arcs light up in turn above a dot, like a signal searching.',
			viewBox: [200, 200],
			params: [num('speed', 'Speed', 1, 0.3, 3, 0.1), { key: 'tone', label: 'Colour', type: 'color', default: '#FFD60A' }],
			nodes: [
				{ type: 'path', repeat: { count: 3 }, attrs: { d: 'M {{100-(36+i*30)*0.7071}} {{150-(36+i*30)*0.7071}} A {{36+i*30}} {{36+i*30}} 0 0 1 {{100+(36+i*30)*0.7071}} {{150-(36+i*30)*0.7071}}', fill: 'none', stroke: '$tone', strokeWidth: 14, strokeLinecap: 'round', glow: 6 }, anim: [{ prop: 'opacity', kind: 'sin', from: 0.15, to: 1, period: '=1.8/speed', phase: '=-i*0.14' }] },
				{ type: 'circle', attrs: { cx: 100, cy: 150, r: 11, fill: '$tone', stroke: 'ink', strokeWidth: 3 }, origin: [100, 150], anim: [{ prop: 'scale', kind: 'sin', from: 0.9, to: 1.15, period: '=1.8/speed' }] },
			],
		},
	},
	{
		id: 'spinner',
		tags: ['loading', 'spinner', 'wait', 'buffering', 'progress', 'busy'],
		spec: {
			name: 'Loading spinner', description: 'A ring with a chasing arc.',
			viewBox: [200, 200],
			params: [num('speed', 'Speed', 1, 0.2, 4, 0.1), num('arc', 'Arc length', 0.3, 0.1, 0.8, 0.05), num('thick', 'Thickness', 14, 6, 26)],
			nodes: [
				{ type: 'circle', attrs: { cx: 100, cy: 100, r: 62, fill: 'none', stroke: 'muted', strokeWidth: '=thick', opacity: 0.4 } },
				{ type: 'circle', attrs: { cx: 100, cy: 100, r: 62, fill: 'none', stroke: 'accent', strokeWidth: '=thick', strokeLinecap: 'round', strokeDasharray: '{{389.5*arc}} 400' }, origin: [100, 100], anim: [{ prop: 'rotate', kind: 'loop', from: 0, to: 360, period: '=1/speed' }] },
			],
		},
	},
	{
		id: 'progress-bar',
		tags: ['progress', 'bar', 'download', 'percent', 'loading', 'upload', 'complete'],
		spec: {
			name: 'Progress bar', description: 'A rounded bar that fills to a value while the percentage counts up.',
			viewBox: [260, 90],
			params: [num('value', 'Value', 80, 0, 100), num('fill_time', 'Fill time (s)', 1.5, 0.3, 5, 0.1), { key: 'label', label: 'Caption', type: 'text', default: 'Downloading' }],
			nodes: [
				{ type: 'text', text: '{{$label}}', attrs: { x: 8, y: 26, fontSize: 24, fontFamily: 'body', fontWeight: 800, fill: 'text' } },
				{ type: 'rect', attrs: { x: 8, y: 40, width: 244, height: 30, rx: 15, fill: 'black', opacity: 0.55, stroke: 'ink', strokeWidth: 3 } },
				{ type: 'rect', attrs: { x: 12, y: 44, width: 0, height: 22, rx: 11, fill: 'accent' }, anim: [{ prop: 'attr:width', kind: 'ramp', from: 8, to: '=8+236*value/100', duration: '=fill_time', ease: 'out' }] },
				{ type: 'text', text: '{{round(value*min(1,t/fill_time))}}%', attrs: { x: 252, y: 26, fontSize: 24, fontFamily: 'display', fill: 'text', textAnchor: 'end' } },
			],
		},
	},
	{
		id: 'signal-bars',
		tags: ['signal', 'bars', 'reception', 'strength', 'cellular', 'quality', 'level'],
		spec: {
			name: 'Signal bars', description: 'Four bars grow in one after another; the lit ones show the level.',
			viewBox: [200, 200],
			params: [num('level', 'Level (bars)', 3, 1, 4), num('speed', 'Speed', 1, 0.3, 3, 0.1)],
			nodes: [
				{ type: 'rect', repeat: { count: 4 }, show: '=i<level', origin: ['=40+i*38+14', 170], attrs: { x: '=40+i*38', y: '=170-(36+i*34)', width: 28, height: '=36+i*34', rx: 7, fill: 'accent', stroke: 'ink', strokeWidth: 3 }, anim: [{ prop: 'scaleY', kind: 'ramp', from: 0, to: 1, duration: '=0.5/speed', delay: '=i*0.15/speed', ease: 'spring' }] },
				{ type: 'rect', repeat: { count: 4 }, show: '=i>=level', origin: ['=40+i*38+14', 170], attrs: { x: '=40+i*38', y: '=170-(36+i*34)', width: 28, height: '=36+i*34', rx: 7, fill: 'muted', opacity: 0.5, stroke: 'ink', strokeWidth: 3 }, anim: [{ prop: 'scaleY', kind: 'ramp', from: 0, to: 1, duration: '=0.5/speed', delay: '=i*0.15/speed', ease: 'spring' }] },
			],
		},
	},
	{
		id: 'heartbeat',
		tags: ['heart', 'ecg', 'pulse', 'health', 'monitor', 'rate', 'beat'],
		spec: {
			name: 'Heartbeat line', description: 'An ECG trace that draws itself on, over and over.',
			viewBox: [300, 120],
			params: [num('bpm', 'Beats per minute', 72, 40, 180), { key: 'tone', label: 'Colour', type: 'color', default: '#FF453A' }],
			nodes: [
				{ type: 'path', attrs: { d: 'M 6 60 L 70 60 L 84 60 L 96 18 L 110 102 L 124 38 L 134 60 L 200 60 L 214 60 L 226 24 L 240 98 L 252 44 L 262 60 L 294 60', fill: 'none', stroke: 'ink', strokeWidth: 12, strokeLinecap: 'round', strokeLinejoin: 'round' }, anim: [{ prop: 'draw', kind: 'loop', from: 0, to: 1, period: '=120/bpm' }] },
				{ type: 'path', attrs: { d: 'M 6 60 L 70 60 L 84 60 L 96 18 L 110 102 L 124 38 L 134 60 L 200 60 L 214 60 L 226 24 L 240 98 L 252 44 L 262 60 L 294 60', fill: 'none', stroke: '$tone', strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round', glow: 5 }, anim: [{ prop: 'draw', kind: 'loop', from: 0, to: 1, period: '=120/bpm' }] },
			],
		},
	},
	{
		id: 'battery',
		tags: ['battery', 'power', 'charge', 'energy', 'level', 'laptop', 'phone'],
		spec: {
			name: 'Battery', description: 'A battery filling to a level, red when low, with a charging bolt.',
			viewBox: [240, 120],
			params: [num('level', 'Level %', 64, 0, 100), { key: 'charging', label: 'Charging', type: 'toggle', default: true }, num('fill_time', 'Fill time (s)', 1.4, 0.3, 4, 0.1)],
			nodes: [
				{ type: 'rect', attrs: { x: 14, y: 22, width: 192, height: 76, rx: 16, fill: 'black', opacity: 0.55, stroke: 'text', strokeWidth: 7 } },
				{ type: 'rect', attrs: { x: 210, y: 46, width: 16, height: 28, rx: 5, fill: 'text', stroke: 'ink', strokeWidth: 3 } },
				{ type: 'rect', show: '=level>20', attrs: { x: 24, y: 32, width: 10, height: 56, rx: 9, fill: 'accent' }, anim: [{ prop: 'attr:width', kind: 'ramp', from: 10, to: '=10+172*level/100', duration: '=fill_time', ease: 'out' }] },
				{ type: 'rect', show: '=level<=20', attrs: { x: 24, y: 32, width: 10, height: 56, rx: 9, fill: 'accent2' }, anim: [{ prop: 'attr:width', kind: 'ramp', from: 10, to: '=10+172*level/100', duration: '=fill_time', ease: 'out' }] },
				{ type: 'polygon', show: '=charging', attrs: { points: '112,30 90,66 108,66 100,92 130,52 111,52', fill: 'text', stroke: 'ink', strokeWidth: 3, strokeLinejoin: 'round' }, anim: [{ prop: 'opacity', kind: 'sin', from: 0.55, to: 1, period: 1.2 }] },
			],
		},
	},
	{
		id: 'checkmark',
		tags: ['check', 'done', 'success', 'complete', 'ok', 'correct', 'tick', 'confirm'],
		spec: {
			name: 'Checkmark', description: 'A circle pops in and a tick draws itself.',
			viewBox: [200, 200],
			params: [{ key: 'tone', label: 'Colour', type: 'color', default: '#3ECF8E' }, num('speed', 'Speed', 1, 0.4, 3, 0.1)],
			nodes: [
				{ type: 'circle', origin: [100, 100], attrs: { cx: 100, cy: 100, r: 72, fill: '$tone', stroke: 'ink', strokeWidth: 6 }, anim: [{ prop: 'scale', kind: 'ramp', from: 0, to: 1, duration: '=0.45/speed', ease: 'spring' }] },
				{ type: 'path', attrs: { d: 'M 62 104 L 90 132 L 142 74', fill: 'none', stroke: 'white', strokeWidth: 16, strokeLinecap: 'round', strokeLinejoin: 'round' }, anim: [{ prop: 'draw', kind: 'ramp', from: 0, to: 1, duration: '=0.4/speed', delay: '=0.3/speed', ease: 'out' }] },
			],
		},
	},
	{
		id: 'notification-bell',
		tags: ['bell', 'notification', 'alert', 'ring', 'reminder', 'subscribe', 'alarm'],
		spec: {
			name: 'Notification bell', description: 'A bell that swings, with a red count badge that pops.',
			viewBox: [200, 200],
			params: [num('count', 'Badge count', 3, 0, 99), num('swing', 'Swing (deg)', 16, 4, 30), num('speed', 'Speed', 1, 0.4, 3, 0.1)],
			nodes: [
				{ type: 'group', origin: [100, 40], anim: [{ prop: 'rotate', kind: 'sin', from: '=-swing', to: '=swing', period: '=0.7/speed' }], children: [
					{ type: 'path', attrs: { d: 'M 100 40 C 68 40 60 70 60 100 L 44 134 L 156 134 L 140 100 C 140 70 132 40 100 40 Z', fill: 'accent', stroke: 'ink', strokeWidth: 6, strokeLinejoin: 'round' } },
					{ type: 'circle', attrs: { cx: 100, cy: 150, r: 13, fill: 'accent', stroke: 'ink', strokeWidth: 5 } },
					{ type: 'circle', attrs: { cx: 100, cy: 32, r: 8, fill: 'accent', stroke: 'ink', strokeWidth: 4 } },
				] },
				{ type: 'circle', show: '=count>0', origin: [148, 54], attrs: { cx: 148, cy: 54, r: 24, fill: 'accent2', stroke: 'ink', strokeWidth: 5 }, anim: [{ prop: 'scale', kind: 'ramp', from: 0, to: 1, duration: 0.5, delay: 0.25, ease: 'spring' }] },
				{ type: 'text', show: '=count>0', text: '{{count}}', attrs: { x: 148, y: 64, fontSize: 28, fontFamily: 'display', fill: 'white', textAnchor: 'middle' } },
			],
		},
	},
	{
		id: 'waving-plant',
		tags: ['plant', 'nature', 'leaf', 'green', 'grow', 'tree', 'wave', 'decor', 'eco'],
		spec: {
			name: 'Waving plant', description: 'A potted plant whose stem sways and leaves flutter.',
			viewBox: [200, 240],
			params: [num('leaves', 'Leaves', 5, 2, 8), num('sway', 'Sway (deg)', 6, 1, 14), num('speed', 'Speed', 1, 0.3, 3, 0.1), { key: 'leaf_color', label: 'Leaf colour', type: 'color', default: '#3DDC84' }],
			nodes: [
				{ type: 'group', origin: [100, 190], anim: [{ prop: 'rotate', kind: 'sin', from: '=-sway', to: '=sway', period: '=2.6/speed' }], children: [
					{ type: 'path', attrs: { d: 'M 100 196 C 96 160 104 120 100 56', fill: 'none', stroke: '$leaf_color', strokeWidth: 7, strokeLinecap: 'round' } },
					{ type: 'ellipse', repeat: { count: '=leaves' }, origin: ['=100+if(mod(i,2)==0,1,-1)*4', '=176-i*(110/leaves)'], attrs: { cx: '=100+if(mod(i,2)==0,1,-1)*22', cy: '=176-i*(110/leaves)', rx: 24, ry: 11, fill: '$leaf_color', stroke: 'ink', strokeWidth: 4 }, anim: [{ prop: 'rotate', kind: 'sin', from: '=if(mod(i,2)==0,-12,12)', to: '=if(mod(i,2)==0,12,-12)', period: '=1.8/speed', phase: '=i*0.2' }] },
				] },
				{ type: 'polygon', attrs: { points: '66,196 134,196 124,236 76,236', fill: 'accent2', stroke: 'ink', strokeWidth: 5, strokeLinejoin: 'round' } },
				{ type: 'rect', attrs: { x: 60, y: 188, width: 80, height: 14, rx: 5, fill: 'accent2', stroke: 'ink', strokeWidth: 5 } },
			],
		},
	},
	{
		id: 'flicker-tube',
		tags: ['light', 'tube', 'neon', 'flicker', 'fluorescent', 'lamp', 'bulb', 'glow'],
		spec: {
			name: 'Flickering tube light', description: 'A tube light whose glow flickers; rate and colour are settings.',
			viewBox: [260, 70],
			params: [num('flicker', 'Flicker rate', 9, 1, 30), num('dim', 'Lowest brightness', 0.25, 0, 0.9, 0.05), { key: 'glow_color', label: 'Light colour', type: 'color', default: '#DFF3FF' }],
			nodes: [
				{ type: 'rect', attrs: { x: 10, y: 22, width: 24, height: 26, rx: 5, fill: 'muted', stroke: 'ink', strokeWidth: 4 } },
				{ type: 'rect', attrs: { x: 226, y: 22, width: 24, height: 26, rx: 5, fill: 'muted', stroke: 'ink', strokeWidth: 4 } },
				{ type: 'rect', attrs: { x: 30, y: 24, width: 200, height: 22, rx: 11, fill: '$glow_color', stroke: 'ink', strokeWidth: 4, glow: 14 }, anim: [{ prop: 'opacity', kind: 'flicker', from: '=dim', to: 1, rate: '=flicker' }] },
			],
		},
	},
	{
		id: 'radar-ping',
		tags: ['radar', 'ping', 'scan', 'sonar', 'detect', 'search', 'location', 'network'],
		spec: {
			name: 'Radar ping', description: 'A sweeping line with rings that expand outward.',
			viewBox: [200, 200],
			params: [num('speed', 'Speed', 1, 0.3, 3, 0.1)],
			nodes: [
				{ type: 'circle', attrs: { cx: 100, cy: 100, r: 84, fill: 'black', opacity: 0.55, stroke: 'accent', strokeWidth: 4 } },
				{ type: 'circle', repeat: { count: 3 }, origin: [100, 100], attrs: { cx: 100, cy: 100, r: 84, fill: 'none', stroke: 'accent', strokeWidth: 4 }, anim: [{ prop: 'scale', kind: 'loop', from: 0.05, to: 1, period: '=2.4/speed', phase: '=i/3', ease: 'out' }, { prop: 'opacity', kind: 'loop', from: 0.9, to: 0, period: '=2.4/speed', phase: '=i/3' }] },
				{ type: 'line', origin: [100, 100], attrs: { x1: 100, y1: 100, x2: 100, y2: 22, stroke: 'accent', strokeWidth: 6, strokeLinecap: 'round', glow: 8 }, anim: [{ prop: 'rotate', kind: 'loop', from: 0, to: 360, period: '=3/speed' }] },
				{ type: 'circle', attrs: { cx: 100, cy: 100, r: 7, fill: 'accent', stroke: 'ink', strokeWidth: 3 } },
			],
		},
	},
	{
		id: 'bouncing-bars',
		tags: ['bars', 'equalizer', 'audio', 'music', 'chart', 'activity', 'data', 'levels'],
		spec: {
			name: 'Bouncing bars', description: 'Five bars bouncing like an audio level meter.',
			viewBox: [240, 160],
			params: [num('speed', 'Speed', 1, 0.3, 3, 0.1), num('height', 'Max height', 120, 40, 150)],
			nodes: [
				{ type: 'rect', repeat: { count: 5 }, origin: ['=22+i*40+14', 150], attrs: { x: '=22+i*40', y: '=150-height', width: 28, height: '=height', rx: 8, fill: 'accent', stroke: 'ink', strokeWidth: 4 }, anim: [{ prop: 'scaleY', kind: 'sin', from: 0.2, to: 1, period: '=0.9/speed', phase: '=i*0.19' }] },
			],
		},
	},
	{
		id: 'thermometer',
		tags: ['temperature', 'thermometer', 'heat', 'hot', 'cold', 'degrees', 'overheating', 'cpu'],
		spec: {
			name: 'Thermometer', description: 'A thermometer whose column rises to a temperature; turns red when hot.',
			viewBox: [140, 240],
			params: [num('temp', 'Temperature (C)', 68, 0, 100), num('rise', 'Rise time (s)', 1.5, 0.3, 4, 0.1)],
			nodes: [
				{ type: 'rect', attrs: { x: 52, y: 14, width: 36, height: 160, rx: 18, fill: 'black', opacity: 0.55, stroke: 'text', strokeWidth: 6 } },
				{ type: 'circle', attrs: { cx: 70, cy: 190, r: 30, fill: 'black', opacity: 0.55, stroke: 'text', strokeWidth: 6 } },
				{ type: 'circle', show: '=temp<=70', attrs: { cx: 70, cy: 190, r: 22, fill: 'accent' } },
				{ type: 'circle', show: '=temp>70', attrs: { cx: 70, cy: 190, r: 22, fill: 'accent2' } },
				{ type: 'rect', show: '=temp<=70', attrs: { x: 62, y: 172, width: 16, height: 0, rx: 8, fill: 'accent' }, anim: [{ prop: 'attr:height', kind: 'ramp', from: 4, to: '=4+134*temp/100', duration: '=rise', ease: 'out' }, { prop: 'attr:y', kind: 'ramp', from: 172, to: '=172-134*temp/100', duration: '=rise', ease: 'out' }] },
				{ type: 'rect', show: '=temp>70', attrs: { x: 62, y: 172, width: 16, height: 0, rx: 8, fill: 'accent2' }, anim: [{ prop: 'attr:height', kind: 'ramp', from: 4, to: '=4+134*temp/100', duration: '=rise', ease: 'out' }, { prop: 'attr:y', kind: 'ramp', from: 172, to: '=172-134*temp/100', duration: '=rise', ease: 'out' }] },
				{ type: 'text', text: '{{round(temp*min(1,t/rise))}}°', attrs: { x: 112, y: 40, fontSize: 28, fontFamily: 'display', fill: 'text', textAnchor: 'start' } },
			],
		},
	},
];

// Parsed once through the schema, so a typo in a preset fails loudly in tests instead of in a video.
export const PRESETS: Preset[] = raw.map((r) => {
	const spec = ElementSpec.parse(r.spec);
	return { id: r.id, name: spec.name, tags: r.tags, description: spec.description ?? '', spec };
});

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
