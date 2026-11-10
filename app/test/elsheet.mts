// Contact sheet of elements over time, without the editor or a server: draws each spec at several moments and screenshots the grid.
//   node ../node_modules/tsx/dist/cli.mjs test/elsheet.mts <out.png> <preset-id | spec.json> [...]  [--times 0.3,0.8,1.6,3]
// Fast way to SEE what a preset or an AI-designed element does (valid is not the same as good).
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioProvider } from '@cls/engine/src/context';
import type { Layer } from '@cls/engine/src/edd/schema';
import { Generated } from '@cls/engine/src/element/Element';
import { PRESETS } from '@cls/engine/src/element/presets';
import { ElementSpec, defaultParams } from '@cls/engine/src/element/spec';

const args = process.argv.slice(2);
const ti = args.indexOf('--times');
const times = (ti >= 0 ? args.splice(ti, 2)[1] : '0.3,0.8,1.6,3').split(',').map(Number);
const [out, ...names] = args;
if (!out || !names.length) throw new Error('usage: elsheet.mts <out.png> <preset-id | spec.json> ... [--times a,b,c]');

const layer = { id: 'sheet', component: 'Generated', props: {}, box: { x: 0, y: 0, w: 20, h: 30, rotation: 0 }, space: 'screen', z: 1, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, meta: { origin: 'ai', locked: false } } as Layer;
const motion = { visible: true, opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 1 };
const draw = (spec: ElementSpec, t: number) =>
	renderToStaticMarkup(React.createElement(StudioProvider, { look: 'footage-first', assetBase: '', children: React.createElement(Generated, { props: { spec, params: defaultParams(spec) }, layer, motion, frame: Math.round(t * 30), time: t, elapsed: t, length: 6 }) }));

const rows = names.map((n) => {
	const spec = existsSync(n) ? ElementSpec.parse(JSON.parse(readFileSync(n, 'utf8')).spec ?? JSON.parse(readFileSync(n, 'utf8'))) : PRESETS.find((p) => p.id === n)?.spec;
	if (!spec) throw new Error(`no preset or file "${n}"`);
	return `<div class="row"><div class="name">${spec.name}</div>${times.map((t) => `<div class="cell" style="aspect-ratio:${spec.viewBox[0]}/${spec.viewBox[1]}">${draw(spec, t)}<i>${t}s</i></div>`).join('')}</div>`;
});
const html = `<html><body style="margin:0;background:#1b2130;font:600 13px system-ui;color:#fff">
<style>.row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #333}.name{width:120px;flex:none}.cell{height:200px;position:relative;background:repeating-linear-gradient(90deg,#232a3b 0 24px,#262e41 24px 48px)}.cell svg{width:100%;height:100%}.cell i{position:absolute;left:4px;top:2px;font:11px system-ui;opacity:.6}</style>
${rows.join('')}</body></html>`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 220 * names.length + 4 } });
const page = await browser.newPage();
await page.setContent(html);
await page.screenshot({ path: out as `${string}.png` });
await browser.close();
console.log(`wrote ${out}`);
process.exit(0);
