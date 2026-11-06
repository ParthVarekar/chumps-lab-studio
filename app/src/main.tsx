import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import './styles.css';

// The UI is served over local HTTP, so the engine's staticFile('fonts/…') resolves to /fonts/… (Vite copies
// engine/public into dist). The UI's own font is registered here.
const base = new URL('.', document.baseURI).href.replace(/\/$/, '');
for (const [weight, file] of [['400', 'inter-latin-600-normal.woff2'], ['600', 'inter-latin-600-normal.woff2'], ['800', 'inter-latin-800-normal.woff2']] as const) {
	const face = new FontFace('Inter', `url(${base}/fonts/${file})`, { weight });
	(document.fonts as unknown as { add(f: FontFace): void }).add(face);
	void face.load();
}

const { App } = await import('./App');
const { useStudio } = await import('./store');
(window as unknown as { __studio: typeof useStudio }).__studio = useStudio; // handle for tests and for scripts that drive the editor in the browser
createRoot(document.getElementById('root')!).render(<App />);
