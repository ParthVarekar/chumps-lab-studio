// Run: npx tsx test/element.test.ts   (from engine/). Plain asserts; exits non-zero on failure.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Generated } from '../src/element/Element';
import { evalExpr } from '../src/element/expr';
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
console.log(`element: all checks passed (${PRESETS.length} presets)`);
