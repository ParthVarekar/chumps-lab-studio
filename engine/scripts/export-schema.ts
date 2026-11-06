/**
 * Export the EDD schema and every component's props schema as JSON Schema, for the Python sidecar
 * and for LLM tool definitions. Also writes the demo document to D:\ChumpsLabStudio\projects\demo.
 *   npm run schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { COMPONENT_LIBRARY, REGISTRY } from '../src/components/registry';
import { DEMO_EDD } from '../src/demo';
import { Edd } from '../src/edd/schema';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'schema');
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'edd.schema.json'), JSON.stringify(z.toJSONSchema(Edd, { io: 'input', unrepresentable: 'any' }), null, 1));
const components = Object.fromEntries(
	Object.entries(REGISTRY).map(([name, def]) => [
		name,
		{ description: def.description, space: def.space ?? 'screen', props: z.toJSONSchema(def.props, { io: 'input', unrepresentable: 'any' }) },
	]),
);
writeFileSync(join(outDir, 'components.schema.json'), JSON.stringify({ library: COMPONENT_LIBRARY, components }, null, 1));

const demoDir = join(process.env.CLS_STUDIO_ROOT ?? 'D:\\ChumpsLabStudio', 'projects', 'demo');
mkdirSync(demoDir, { recursive: true });
writeFileSync(join(demoDir, 'edd.json'), JSON.stringify(DEMO_EDD, null, 1));
console.log(`wrote ${outDir}\\edd.schema.json, components.schema.json and ${demoDir}\\edd.json`);
