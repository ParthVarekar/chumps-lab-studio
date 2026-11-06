// Full-resolution screenshots of the running editor (drives the installed Chrome via puppeteer-core).
//   npx tsx test/shot.mts out.png [--w 1600] [--h 950] [--wait 4000] [--project <dir>]
//     [--js "code"]  run in the page (async, may use document)   [--shot file.png]  extra screenshot   [--sleep ms]
//     [--click "css"] click an element    [--type "css|text"] type into an element
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const w = Number(opt('--w', '1600'));
const h = Number(opt('--h', '950'));
const project = opt('--project', 'D:/ChumpsLabStudio/projects/raw-loop-kokoro');
const steps: { k: string; v: string }[] = [];
for (let i = 1; i < args.length; i++) if (['--js', '--shot', '--sleep', '--click', '--type'].includes(args[i])) steps.push({ k: args[i], v: args[++i] });

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: w, height: h } });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[browser error]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[page error]', String(e).slice(0, 400)));
await page.goto(`http://localhost:4173/index.html?project=${encodeURIComponent(project)}`, { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, Number(opt('--wait', '5000'))));
mkdirSync(dirname(out), { recursive: true });
for (const s of steps) {
	if (s.k === '--js') {
		const r = await page.evaluate(`(async () => { ${s.v} })()`).catch((e: Error) => `error: ${e.message}`);
		if (r !== undefined) console.log('js ->', typeof r === 'string' ? r.slice(0, 400) : JSON.stringify(r)?.slice(0, 400));
		await new Promise((r2) => setTimeout(r2, 700));
	} else if (s.k === '--click') { await page.click(s.v).catch((e: Error) => console.log('click failed', s.v, e.message)); await new Promise((r2) => setTimeout(r2, 700)); }
	else if (s.k === '--type') { const [sel, text] = s.v.split('|'); await page.type(sel, text); await new Promise((r2) => setTimeout(r2, 300)); }
	else if (s.k === '--sleep') await new Promise((r2) => setTimeout(r2, Number(s.v)));
	else if (s.k === '--shot') { await page.screenshot({ path: s.v as `${string}.png` }); console.log('wrote', s.v); }
}
await page.screenshot({ path: out as `${string}.png` });
console.log('wrote', out);
await browser.close();
process.exit(0);
