// Chumps Lab Studio, desktop window. The editor itself is the web app served by server/main.ts at
// http://localhost:4173 (see `npm run web`); this just starts that server and shows it in a window.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.CLS_WEB_PORT || 4173);
const APP = path.resolve(__dirname, '..');
let server = null;

const up = () => new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: '/index.html', timeout: 800 }, (r) => { r.resume(); resolve(true); }).on('error', () => resolve(false)));

app.whenReady().then(async () => {
	if (!(await up())) {
		// tsx runs the TypeScript server; it is hoisted to the repo root's node_modules.
		const tsx = path.resolve(APP, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
		server = spawn(process.execPath.includes('electron') ? 'node' : process.execPath, [tsx, 'server/main.ts'], { cwd: APP, stdio: 'inherit', shell: process.platform === 'win32' });
		for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
	}
	const win = new BrowserWindow({ width: 1680, height: 1000, backgroundColor: '#101114', title: 'Chumps Lab Studio', webPreferences: { sandbox: true } });
	win.removeMenu();
	win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
	win.loadURL(`http://localhost:${PORT}/index.html`);
});

app.on('window-all-closed', () => { if (server) server.kill(); app.quit(); });
