/**
 * Export Simple Icons (CC0) brand marks as SVG files into a project's media folder.
 *   npx tsx scripts/export-icons.ts <outDir> <slug> [<slug> …] [--color #FFFFFF]
 */
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const set = JSON.parse(readFileSync(require.resolve('@iconify-json/simple-icons/icons.json'), 'utf8'));

export const exportIcons = (outDir: string, slugs: string[], color = '#FFFFFF') => {
	mkdirSync(outDir, { recursive: true });
	for (const slug of slugs) {
		const data = getIconData(set, slug);
		if (!data) throw new Error(`no Simple Icons icon named "${slug}"`);
		const svg = iconToSVG(data, { height: 512 });
		const body = svg.body.replace(/currentColor/g, color);
		writeFileSync(join(outDir, `${slug}.svg`), iconToHTML(body, { ...svg.attributes, xmlns: 'http://www.w3.org/2000/svg' }));
	}
};

if (process.argv[1]?.endsWith('export-icons.ts')) {
	const args = process.argv.slice(2);
	const ci = args.indexOf('--color');
	const color = ci >= 0 ? args.splice(ci, 2)[1] : '#FFFFFF';
	const [outDir, ...slugs] = args;
	exportIcons(outDir, slugs, color);
	console.log(`exported ${slugs.length} icons to ${outDir}`);
}
