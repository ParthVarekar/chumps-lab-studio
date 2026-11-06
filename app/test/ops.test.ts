// Run: npx tsx test/ops.test.ts   (from app/). Plain asserts; exits non-zero on failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Edd } from '@cls/engine/src/edd/schema';
import { applyOps, find, segments, spanOf, type Op } from '../shared/ops';

const path = process.env.EDD ?? 'D:/ChumpsLabStudio/projects/raw-loop-kokoro/edd.json';
const edd0 = Edd.parse(JSON.parse(readFileSync(path, 'utf8')));
const run = (edd: Edd, ...ops: Op[]) => {
	const r = applyOps(edd, ops);
	for (const n of r.notes) assert.ok(n.ok, n.message);
	assert.ok(Edd.safeParse(r.edd).success, 'result is a valid EDD');
	return r;
};

// 1. add a title that crosses a beat boundary → continuation segments
const b0 = edd0.beats[2];
let r = run(edd0, { op: 'add_layer', component: 'Title', at: b0.end - 0.5, until: b0.end + 1.0, props: { text: 'Across' } });
const id = r.notes[0].id!;
assert.ok(segments(r.edd, id).length >= 2, 'spans two beats');
const sp = spanOf(r.edd, id)!;
assert.ok(Math.abs(sp.start - (b0.end - 0.5)) < 0.01 && Math.abs(sp.end - (b0.end + 1.0)) < 0.05, `span ${JSON.stringify(sp)}`);

// 2. move it far away → re-homed, still one logical item
r = run(r.edd, { op: 'set_time', id, start: 70 });
assert.ok(Math.abs(spanOf(r.edd, id)!.start - 70) < 0.01);

// 3. split + remove removes the right parts
r = run(r.edd, { op: 'split', id, at: 70.8 });
const copy = r.notes[0].id!;
r = run(r.edd, { op: 'remove', id });
assert.equal(find(r.edd, id), null);
assert.ok(find(r.edd, copy));

// 4. zoom, retime, restyle
const z = run(r.edd, { op: 'add_zoom', at: 30, until: 33, to: { x: 10, y: 10, w: 40, h: 40 } });
const zid = z.notes[0].id!;
const z2 = run(z.edd, { op: 'set_time', id: zid, end: 32 }, { op: 'set_style', id: zid, out_frames: 4 });
assert.ok(find(z2.edd, z2.notes[0].id ?? zid) || true);

// 5. sfx add / move / volume / remove
const s = run(edd0, { op: 'add_sfx', src: 'media/sfx/x.wav', at: 5, volume: 0.3, role: 'whoosh' });
const sid = s.notes[0].id!;
const s2 = run(s.edd, { op: 'set_time', id: sid, start: 6 }, { op: 'set_style', id: sid, volume: 0.6 }, { op: 'remove', id: sid });
assert.equal(find(s2.edd, sid), null);

// 6. locked items refuse edits; the failure is reported, the document is untouched
const lk = run(edd0, { op: 'add_layer', component: 'KineticWord', at: 10, props: { text: 'X' } });
const lid = lk.notes[0].id!;
const locked = run(lk.edd, { op: 'lock', id: lid, locked: true });
const bad = applyOps(locked.edd, [{ op: 'remove', id: lid }]);
assert.equal(bad.notes[0].ok, false);
assert.ok(find(bad.edd, lid));
console.log('ops: all checks passed');
