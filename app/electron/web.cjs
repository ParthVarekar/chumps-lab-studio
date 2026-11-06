// Chumps Lab Studio in a browser: `npm run web` → http://localhost:4173
// The same editor UI as the desktop app, served by a small local server that implements the studio API over HTTP.
// Only listens on 127.0.0.1. Every request to /api must carry the X-Studio header and a localhost Origin/Host, so
// another web page you happen to have open can't drive it.
const http = require('node:http');
const path = require('node:path');
const handler = require('serve-handler');
const { createCore } = require('./core.cjs');

const PORT = Number(process.env.CLS_WEB_PORT || 4173);
const logClients = new Set();
const core = createCore({ onLog: (s) => logClients.forEach((res) => res.write(`data: ${JSON.stringify(s)}\n\n`)) });
const dist = path.join(__dirname, '..', 'dist');

const localhost = (h) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h || '');
const readJson = (req) =>
	new Promise((resolve, reject) => {
		let body = '';
		req.on('data', (c) => {
			body += c;
			if (body.length > 50e6) reject(new Error('body too large'));
		});
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (e) {
				reject(e);
			}
		});
	});

const routes = {
	'GET /api/projects': () => core.listProjects(),
	'POST /api/open': (b) => core.openProject(b.dir),
	'POST /api/save': (b) => core.saveEdd(b),
	'POST /api/render': (b) => core.startRender(b.dir),
	'POST /api/replan': (b) => core.startReplan(b.dir),
};

http
	.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		if (url.pathname.startsWith('/api/')) {
			const origin = req.headers.origin;
			if (!localhost(req.headers.host) || (origin && !localhost(new URL(origin).host)) || req.headers['x-studio'] !== '1') {
				res.writeHead(403).end('forbidden');
				return;
			}
			if (url.pathname === '/api/log') {
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
				res.write(': connected\n\n');
				logClients.add(res);
				req.on('close', () => logClients.delete(res));
				return;
			}
			const route = routes[`${req.method} ${url.pathname}`];
			if (!route) {
				res.writeHead(404).end('not found');
				return;
			}
			try {
				const result = await route(req.method === 'POST' ? await readJson(req) : {});
				res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? null));
			} catch (e) {
				res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message || e) }));
			}
			return;
		}
		// cleanUrls off: serve-handler otherwise redirects /index.html?… to / and drops the query string.
		handler(req, res, { public: dist, directoryListing: false, cleanUrls: false });
	})
	.listen(PORT, '127.0.0.1', () => console.log(`Chumps Lab Studio: http://localhost:${PORT}  (projects: ${core.PROJECTS})`));
