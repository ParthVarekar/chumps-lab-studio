// Talk to the assistant from the command line, exactly as the editor's chat does (and as another AI could).
//   node ../node_modules/tsx/dist/cli.mjs test/ask.mts "message" [--time 64] [--select b4cam1,u2] [--apply]
const args = process.argv.slice(2);
const message = args[0];
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const dir = opt('--project', 'D:/ChumpsLabStudio/projects/raw-loop-kokoro');
const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const post = async (p: string, b: unknown) => (await fetch(`http://localhost:4173${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json() as Promise<any>;

await post('/api/open', { dir });
const t0 = Date.now();
const r = await post('/api/assistant', { dir, message, time: Number(opt('--time', '0')), selection: opt('--select', '').split(',').filter(Boolean) });
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s ${r.source}${r.via ? ' via ' + r.via : ''}] ${r.reply}`);
if (r.options?.length) console.log('options:', r.options);
for (const o of r.ops ?? []) console.log('  op', JSON.stringify(o).slice(0, 260));
if (r.ops?.length) {
	const d = await post('/api/ops', { dir, ops: r.ops, dryRun: true });
	for (const n of d.notes) console.log(`  ${n.ok ? 'ok ' : 'BAD'} ${n.message}`);
	if (args.includes('--apply')) {
		const x = await post('/api/ops', { dir, ops: r.ops, author: 'ai' });
		console.log(`applied ${x.applied}, rev ${x.rev}`);
	}
}
