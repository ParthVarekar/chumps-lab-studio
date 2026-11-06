import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The renderer imports the engine's compositions directly, so the preview uses exactly the same
// components as the final render. The engine's public/ (bundled fonts) is served as-is.
export default defineConfig({
	root: resolve(__dirname, 'src'),
	base: './',
	publicDir: resolve(__dirname, '..', 'engine', 'public'),
	plugins: [react()],
	build: { target: 'es2022', outDir: resolve(__dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
	server: { port: 5199 },
});
