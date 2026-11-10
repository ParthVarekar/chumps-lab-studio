// Run: npx tsx test/element.test.ts   (from engine/). Plain asserts; exits non-zero on failure.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Generated } from '../src/element/Element';
import { evalExpr } from '../src/element/expr';
import { easeBy, presence } from '../src/element/motion';
import { PRESETS } from '../src/element/presets';
import { ElementSpec, checkSpec, expandedCount } from '../src/element/spec';
import { StudioProvider } from '../src/context';
import type { Layer } from '../src/edd/schema';
import { REGISTRY } from '../src/components/registry';

// ---- expressions
assert.ok(Math.abs(evalExpr('-120 + 72/100*240', {}) - 52.8) < 1e-9);
assert.equal(evalExpr('if(value > 80, 1, 0.4)', { value: 90 }), 1);
assert.ok(Math.abs(evalExpr('cos(60) + sin(30)', {}) - 1) < 1e-9);
assert.equal(evalExpr('2 ^ 3 ^ 2', {}), 512); // right-associative
assert.equal(evalExpr('mod(-1, 3)', {}), 2);
assert.equal(evalExpr('clamp(15, 0, 10)', {}), 10);
for (const bad of ['process.exit()', 'constructor', '1 +', 'alert(1)', 'a.b', '"x"', 'sin(1,)']) {
	assert.throws(() => evalExpr(bad, { a: 1 }), undefined, `must reject: ${bad}`);
}

// ---- every preset is valid and has no check errors
assert.ok(PRESETS.length >= 12, `${PRESETS.length} presets`);
for (const p of PRESETS) {
	const errs = checkSpec(p.spec).filter((i) => i.level === 'error');
	assert.deepEqual(errs, [], `${p.id}: ${JSON.stringify(errs)}`);
	assert.ok(expandedCount(p.spec) < 120, `${p.id} node count`);
}

// ---- every preset renders, and moves between times
const layer = { id: 'e1', component: 'Generated', props: {}, box: { x: 0, y: 0, w: 20, h: 30, rotation: 0 }, space: 'screen', z: 10, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, meta: { origin: 'ai', locked: false } } as Layer;
const motion = { visible: true, opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 1 };
const html = (spec: ElementSpec, params: Record<string, unknown>, t: number) =>
	renderToStaticMarkup(
		React.createElement(StudioProvider, { look: 'footage-first', assetBase: '' }, React.createElement(Generated, { props: { spec, params }, layer, motion, frame: Math.round(t * 30), time: t, elapsed: t, length: 5 })),
	);
for (const p of PRESETS) {
	const a = html(p.spec, {}, 0.3);
	const b = html(p.spec, {}, 1.1);
	assert.ok(a.includes('<svg') && a.length > 200, `${p.id} drew nothing`);
	assert.ok(!/NaN|undefined|Infinity/.test(a + b), `${p.id} has NaN/undefined in its markup`);
	assert.notEqual(a, b, `${p.id} does not change over time`);
}

// ---- settings really drive the drawing
const speedo = PRESETS.find((p) => p.id === 'speedometer')!.spec;
assert.ok(/rotate\(-?[\d.]+\)/.test(html(speedo, { value: 20 }, 3)));
assert.notEqual(html(speedo, { value: 20 }, 3), html(speedo, { value: 95 }, 3));
assert.ok(html(speedo, { value: 95 }, 3).includes('#FF453A'), 'above 80 the dial uses the alert colour');
assert.ok(html(speedo, { value: 50, label: 'CPU' }, 3).includes('>CPU<'), 'text params appear');

// ---- unsafe or broken specs are rejected
const base = (nodes: unknown, params: unknown = []) => ({ name: 'x', viewBox: [100, 100], params, nodes });
const rejected = (spec: unknown) => {
	const parsed = ElementSpec.safeParse(spec);
	return !parsed.success || checkSpec(parsed.data).some((i) => i.level === 'error');
};
assert.ok(rejected(base([{ type: 'circle', attrs: { r: 5, href: 'http://evil' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'href');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: 5, onclick: 'alert(1)' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'event handler');
assert.ok(rejected(base([{ type: 'rect', attrs: { fill: 'url(javascript:alert(1))' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'url()');
assert.ok(rejected(base([{ type: 'script', attrs: {} }])), 'unknown node type');
assert.ok(rejected(base([{ type: 'path', attrs: { d: 'M0 0 <script>' }, anim: [{ prop: 'draw', kind: 'ramp', duration: 1 }] }])), 'path injection');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: '=nope*2' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'unknown name in expression');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: '=eval(1)' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'unknown function');
assert.ok(rejected(base([{ type: 'circle', repeat: { count: 5000 }, attrs: { r: 1 }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'node explosion');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: 5 } }])), 'nothing moves');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: '$ghost' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'unknown parameter');
assert.ok(rejected(base([{ type: 'circle', attrs: { r: 5 }, anim: [{ prop: 'opacity', kind: 'sin' }] }])), 'sin without period');
assert.ok(!rejected(base([{ type: 'circle', attrs: { r: 5, fill: 'accent' }, anim: [{ prop: 'opacity', kind: 'sin', period: 1 }] }])), 'a good spec passes');

// ---- the registry knows the new components
for (const k of ['Highlight', 'Spotlight', 'BlurRegion', 'Arrow', 'ClickRipple', 'StepBadge', 'LowerThird', 'Flash', 'FadeBlack', 'Wipe', 'Glitch', 'Vignette', 'Letterbox', 'Captions', 'Generated']) assert.ok(REGISTRY[k], k);


// Mistakes a model makes that the checks must catch (or tolerate): spinning words, "$$label", missing pivots.
{
	const base = { name: 't', viewBox: [200, 200] as [number, number], params: [{ key: 'label', label: 'Label', type: 'text' as const, default: 'Hi' }] };
	const spin = ElementSpec.parse({ ...base, nodes: [{ type: 'group', origin: [100, 100], anim: [{ prop: 'rotate', kind: 'loop', from: 0, to: 360, period: 2 }], children: [{ type: 'circle', attrs: { cx: 100, cy: 100, r: 40, fill: 'accent' } }, { type: 'text', attrs: { x: 100, y: 100, fontSize: 24 }, text: 'Go' }] }] });
	assert.ok(checkSpec(spin).some((i) => i.level === 'error' && /spin/.test(i.message)), 'a spinning group holding text is an error');
	const dollars = ElementSpec.parse({ ...base, nodes: [{ type: 'text', attrs: { x: 100, y: 100, fontSize: 24 }, text: '$$label', anim: [{ prop: 'opacity', kind: 'sin', from: 0.5, to: 1, period: 2 }] }] });
	assert.deepEqual(checkSpec(dollars).filter((i) => i.level === 'error'), [], '"$$label" naming a real param is accepted');
	assert.ok(html(dollars, { label: 'Wi-Fi' }, 1).includes('Wi-Fi') && !html(dollars, { label: 'Wi-Fi' }, 1).includes('$$'), 'bare $$label resolves to the param value');
	const unknown = ElementSpec.parse({ ...base, nodes: [{ type: 'text', attrs: { x: 1, y: 1, fontSize: 24 }, text: '$nope', anim: [{ prop: 'opacity', kind: 'sin', from: 0.5, to: 1, period: 2 }] }] });
	assert.ok(checkSpec(unknown).some((i) => i.level === 'error'), 'an unknown text param is an error');
	const noOrigin = ElementSpec.parse({ ...base, nodes: [{ type: 'rect', attrs: { x: 80, y: 80, width: 40, height: 40, fill: 'accent' }, anim: [{ prop: 'rotate', kind: 'loop', from: 0, to: 360, period: 2 }] }] });
	assert.ok(/translate\(80 80\)|translate\(100 100\)/.test(html(noOrigin, {}, 0.5)), 'a rect with no origin pivots on its own centre');
}

// A colour setting may default to a theme word, and a bare formula in a numeric attribute is read as an expression.
{
	const spec = ElementSpec.parse({ name: 't', viewBox: [200, 200], params: [{ key: 'tint', label: 'Tint', type: 'color', default: 'accent' }, { key: 'gap', label: 'Gap', type: 'number', min: 0, max: 50, default: 20 }],
		nodes: [{ type: 'rect', repeat: { count: 3 }, attrs: { x: '20+i*gap', y: 50, width: 10, height: '30+i*10', fill: '$tint' }, anim: [{ prop: 'opacity', kind: 'sin', from: 0.6, to: 1, period: 2 }] }] });
	assert.deepEqual(checkSpec(spec).filter((i) => i.level === 'error'), [], 'bare formulas and theme-word params pass the checks');
	const m = html(spec, { tint: 'accent', gap: 30 }, 1);
	assert.ok(!/fill="accent"/.test(m), 'a theme word held in a colour param becomes a real colour');
	assert.ok(/x="50"/.test(m) && /x="80"/.test(m), 'x="20+i*gap" is evaluated per repeat (50 and 80 for gap 30)');
}

// Motion language (openclicky / hallmark tokens), staged entrances and the 3D scene renderer.
{
	assert.equal(easeBy(0, 'expo'), 0);
	assert.ok(Math.abs(easeBy(1, 'expo') - 1) < 1e-6 && easeBy(0.3, 'expo') > 0.6, 'ease-out-expo is fast then settles');
	assert.equal(presence(0.4, 0.5, 0.6), 0, 'nothing before its moment');
	assert.ok(presence(5, 0.5, 0.6) === 1 && presence(5, 0.5, 0.6, 4) === 0, 'settled, and gone after `until`');
	const d1 = presence(4.2, 0.5, 0.6, 4), d0 = presence(0.7, 0.5, 0.6);
	assert.ok(d1 > 0 && d1 < 1 && d0 > 0 && d0 < 1, 'eases in and out');
	assert.ok(Math.abs(evalExpr('ease(1)', {}) - 1) < 1e-9 && evalExpr('ease(0.2)', {}) > 0.7);

	const staged = ElementSpec.parse({ name: 's', viewBox: [200, 200], nodes: [
		{ type: 'rect', attrs: { x: 20, y: 20, width: 60, height: 60, fill: 'accent' }, appear: { at: 1, kind: 'rise' } },
		{ type: 'rect', attrs: { x: 100, y: 100, width: 60, height: 60, fill: 'accent' } },
		{ type: 'circle', attrs: { cx: 50, cy: 150, r: 20, fill: 'white' } },
	] });
	assert.deepEqual(checkSpec(staged).filter((i) => i.level === 'error'), [], 'an entrance counts as motion');
	assert.equal((html(staged, {}, 0.5).match(/<rect/g) ?? []).length, 1, 'the staged shape is not drawn before its time');
	assert.equal((html(staged, {}, 3).match(/<rect/g) ?? []).length, 2, 'and is there afterwards');

	const cube = ElementSpec.parse({ name: 'c', viewBox: [200, 200], nodes: [{ type: 'scene3d', camera: { yaw: '=30+t*20', pitch: 25 }, objects: [
		{ shape: 'box', size: 60, at: [0, 0, 0], color: 'accent' },
		{ shape: 'cylinder', size: [30, 50, 30], at: [70, 0, 0], color: 'white' },
		{ shape: 'label', text: 'Hi', at: [0, 80, 0] },
		{ shape: 'line', at: [0, 30, 0], to: [70, 30, 0], arrow: true },
	] }] });
	assert.deepEqual(checkSpec(cube).filter((i) => i.level === 'error'), [], 'a 3D scene with an orbiting camera is valid');
	const m0 = html(cube, {}, 0.5), m1 = html(cube, {}, 2);
	const polys = (m0.match(/<polygon/g) ?? []).length;
	assert.ok(polys >= 3 + 10 && polys < 60, `back faces are culled (${polys} polygons for a cube + cylinder)`);
	assert.ok(m0.includes('>Hi</text>') && m0.includes('<line'), 'labels and lines are drawn');
	assert.notEqual(m0, m1, 'the camera orbit changes the picture');
	assert.ok(!/NaN|Infinity|undefined/.test(m0 + m1));
	// Everything stays inside the frame: the scene is fitted, whatever units the author used.
	const big = ElementSpec.parse({ name: 'b', viewBox: [200, 200], nodes: [{ type: 'scene3d', objects: [{ shape: 'box', size: [900, 400, 900], at: [0, 0, 0], appear: { at: 0, kind: 'pop' } }] }] });
	const xs = [...html(big, {}, 3).matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(/[ ,]/).map(Number));
	assert.ok(xs.length > 0 && Math.min(...xs) >= -1 && Math.max(...xs) <= 201, `an oversized scene is scaled to fit (${Math.min(...xs)}..${Math.max(...xs)})`);
	const bad = ElementSpec.parse({ name: 'x', viewBox: [200, 200], nodes: [{ type: 'scene3d', objects: [{ shape: 'line', at: [0, 0, 0] }, { shape: 'box', size: '=nope*2', appear: { at: 0 } }] }] });
	const errs = checkSpec(bad).filter((i) => i.level === 'error').map((i) => i.message).join(' | ');
	assert.ok(/needs "to"/.test(errs) && /unknown name "nope"/.test(errs), errs);
}
console.log(`element: all checks passed (${PRESETS.length} presets)`);
