import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/**
 * Fonts are bundled files (copied from @fontsource by scripts/copy-fonts.mjs), never fetched from
 * the web, so renders are offline and reproducible. loadFont() holds the render until they load.
 */
const FONTS = [
	{ family: 'Archivo Black', file: 'archivo-black-latin-400-normal.woff2', weight: '400' },
	{ family: 'Inter', file: 'inter-latin-600-normal.woff2', weight: '600' },
	{ family: 'Inter', file: 'inter-latin-800-normal.woff2', weight: '800' },
	{ family: 'JetBrains Mono', file: 'jetbrains-mono-latin-500-normal.woff2', weight: '500' },
] as const;

let loaded: Promise<unknown> | null = null;

export const ensureFonts = () => {
	if (!loaded) {
		loaded = Promise.all(
			FONTS.map((f) => loadFont({ family: f.family, url: staticFile(`fonts/${f.file}`), weight: f.weight })),
		);
	}
	return loaded;
};
