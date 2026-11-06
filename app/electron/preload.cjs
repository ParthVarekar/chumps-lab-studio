// The only bridge between the page and the machine: a small, explicit API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
	listProjects: () => ipcRenderer.invoke('projects:list'),
	openProject: (dir) => ipcRenderer.invoke('project:open', dir),
	saveEdd: (args) => ipcRenderer.invoke('edd:save', args),
	render: (dir) => ipcRenderer.invoke('render:start', dir),
	replan: (dir) => ipcRenderer.invoke('ai:replan', dir),
	onRenderLog: (cb) => {
		const fn = (_e, s) => cb(s);
		ipcRenderer.on('render:log', fn);
		return () => ipcRenderer.removeListener('render:log', fn);
	},
	openPath: (p) => ipcRenderer.invoke('shell:open', p),
	selftestCapture: (name) => ipcRenderer.invoke('selftest:capture', name),
	selftestDone: (summary) => ipcRenderer.invoke('selftest:done', summary),
});
