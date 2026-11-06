// Chumps Lab Studio — the part of the app that touches the machine, shared by the Electron window and the
// local web server (web.cjs), so the editor behaves the same in both.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const handler = require('serve-handler');

const STUDIO_ROOT = process.env.CLS_STUDIO_ROOT || 'D:\\ChumpsLabStudio';
const PROJECTS = path.join(STUDIO_ROOT, 'projects');
const ENGINE = path.resolve(__dirname, '..', '..', 'engine');
const SIDECAR = path.resolve(__dirname, '..', '..', 'sidecar');

/** A project folder must be inside the studio's projects folder: the page is never allowed to name any other path. */
function safeDir(dir) {
	const resolved = path.resolve(String(dir));
	if (resolved !== PROJECTS && !resolved.startsWith(PROJECTS + path.sep)) throw new Error('not a studio project folder');
	return resolved;
}

function createCore({ onLog }) {
	const media = new Map(); // dir -> { server, url }: several open projects (or clients) must not close each other's media
	let job = null; // the running render / AI job

	async function serveProject(dir) {
		const have = media.get(dir);
		if (have) return have.url;
		if (media.size >= 4) { const [oldDir, old] = media.entries().next().value; media.delete(oldDir); await new Promise((r) => old.server.close(r)); }
		const server = http.createServer((req, res) => {
			res.setHeader('Access-Control-Allow-Origin', '*');
			handler(req, res, { public: dir, directoryListing: false, etag: true });
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		const entry = { server, url: `http://127.0.0.1:${server.address().port}/` };
		media.set(dir, entry);
		return entry.url;
	}

	function run(cmd, args, opts, collect) {
		return new Promise((resolve) => {
			job = spawn(cmd, args, { ...opts, shell: process.platform === 'win32' });
			let out = '';
			const forward = (buf) => {
				const s = buf.toString();
				if (collect) out += s;
				onLog(s);
			};
			job.stdout.on('data', forward);
			job.stderr.on('data', forward);
			job.on('close', (code) => {
				job = null;
				resolve({ code, out });
			});
		});
	}

	return {
		PROJECTS,
		safeDir,

		listProjects() {
			if (!fs.existsSync(PROJECTS)) return [];
			return fs
				.readdirSync(PROJECTS, { withFileTypes: true })
				.filter((d) => d.isDirectory() && fs.existsSync(path.join(PROJECTS, d.name, 'edd.json')))
				.map((d) => {
					const p = path.join(PROJECTS, d.name, 'edd.json');
					return { name: d.name, dir: path.join(PROJECTS, d.name), modified: fs.statSync(p).mtimeMs };
				})
				.sort((a, b) => b.modified - a.modified);
		},

		async openProject(dirIn) {
			const dir = safeDir(dirIn);
			const edd = JSON.parse(fs.readFileSync(path.join(dir, 'edd.json'), 'utf8'));
			const reportPath = path.join(dir, 'prototype_report.json');
			const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
			const historyDir = path.join(dir, 'history');
			const history = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter((f) => f.endsWith('.patch.json')).length : 0;
			return { dir, edd, report, history, assetBase: await serveProject(dir) };
		},

		// Every change is saved as the new document plus a JSON-Patch record of what changed and who changed it.
		saveEdd({ dir: dirIn, edd, patch, author, note }) {
			const dir = safeDir(dirIn);
			const historyDir = path.join(dir, 'history');
			fs.mkdirSync(historyDir, { recursive: true });
			const n = fs.readdirSync(historyDir).filter((f) => f.endsWith('.patch.json')).length + 1;
			const record = { n, ts: new Date().toISOString(), author, note, patch };
			fs.writeFileSync(path.join(historyDir, `${String(n).padStart(6, '0')}.patch.json`), JSON.stringify(record, null, 1));
			const tmp = path.join(dir, 'edd.json.tmp');
			fs.writeFileSync(tmp, JSON.stringify(edd, null, 1));
			fs.renameSync(tmp, path.join(dir, 'edd.json'));
			return { n };
		},

		async startRender(dirIn) {
			const dir = safeDir(dirIn);
			if (job) return { error: 'a job is already running' };
			const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
			const { code, out } = await run(npx, ['tsx', 'scripts/render.ts', path.join(dir, 'edd.json'), '--concurrency', '6'], { cwd: ENGINE }, true);
			const m = out.match(/^(.*\.mp4)\s*$/m);
			return { code, output: m ? m[1].trim() : null };
		},

		// AI re-plan: runs the sidecar planner on the project. Locked / user-edited items are kept (merge.py).
		async startReplan(dirIn) {
			const dir = safeDir(dirIn);
			if (job) return { error: 'a job is already running' };
			const { code } = await run('uv', ['run', 'python', '-m', 'cls_sidecar.prototype', dir, '--replan', '--no-vl'],
				{ cwd: SIDECAR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, false);
			return { code };
		},
	};
}

module.exports = { createCore, safeDir, PROJECTS, STUDIO_ROOT };
