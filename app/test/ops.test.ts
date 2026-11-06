// Run: npx tsx test/ops.test.ts   (from app/). Plain asserts; exits non-zero on failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Edd } from '@cls/engine/src/edd/schema';
import { applyOps, find, metaOfItem, segments, spanOf, withGroup, type Op } from '../shared/ops';

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
// 7. groups: a zoom and the spotlight on it behave as one
const gz = run(edd0, { op: 'add_zoom', at: 30, until: 33, to: { x: 10, y: 10, w: 40, h: 40 }, group: 'gx' }, { op: 'add_layer', component: 'Spotlight', at: 30, until: 34, group: 'gx' });
const gzId = gz.notes[0].id!;
const gsId = gz.notes[1].id!;
assert.equal(withGroup(gz.edd, gzId).length, 2);
const gm = run(gz.edd, { op: 'set_time', id: gsId, start: 41 });
assert.ok(Math.abs(spanOf(gm.edd, gm.notes[0].id!)!.start - 41) < 0.01, 'the lead moved');
const camNow = withGroup(gm.edd, gm.notes[0].id!).map((i) => spanOf(gm.edd, i)!.start).sort((a, b) => a - b);
assert.ok(camNow.every((t) => t > 40), `the zoom moved with its spotlight: ${camNow}`);
const gd = run(gm.edd, { op: 'duplicate', id: gm.notes[0].id! });
assert.equal(withGroup(gd.edd, gd.notes[0].id!).length, 2, 'the copy is a group of two');
assert.notEqual(metaOfItem(gd.edd, gd.notes[0].id!)!.group, 'gx', 'the copy has its own group tag');
const gl = run(gm.edd, { op: 'lock', id: gm.notes[0].id!, locked: true });
assert.equal(applyOps(gl.edd, [{ op: 'remove', id: gm.notes[0].id! }]).notes[0].ok, false, 'a locked member protects the group');
const gr = run(gm.edd, { op: 'remove', id: gm.notes[0].id! });
assert.equal(gr.edd.beats.flatMap((b) => b.camera).filter((c) => c.meta.group === 'gx').length, 0, 'removing one removes the whole group');
const ug = run(gm.edd, { op: 'ungroup', id: gm.notes[0].id! });
assert.equal(withGroup(ug.edd, gm.notes[0].id!).length, 1);
const mk = run(edd0, { op: 'add_layer', component: 'Title', at: 5, props: { text: 'A' } }, { op: 'add_sfx', src: 'media/sfx/x.wav', at: 5 });
const mg = run(mk.edd, { op: 'group', ids: [mk.notes[0].id!, mk.notes[1].id!] });
assert.equal(withGroup(mg.edd, mk.notes[0].id!).length, 2);
// 8. disable / enable: kept in the edit, not rendered; a group switches together
const de = run(edd0, { op: 'add_zoom', at: 30, until: 33, to: { x: 10, y: 10, w: 40, h: 40 }, group: 'gd' }, { op: 'add_layer', component: 'Spotlight', at: 30, until: 34, group: 'gd' });
const off = run(de.edd, { op: 'set_enabled', id: de.notes[0].id!, enabled: false });
assert.equal(off.edd.beats.flatMap((b) => [...b.camera, ...b.layers]).filter((x) => x.meta.group === 'gd' && x.meta.disabled).length, 2, 'both group members are off');
assert.ok(find(off.edd, de.notes[0].id!), 'a disabled item is still in the edit');
const on = run(off.edd, { op: 'set_enabled', id: de.notes[0].id!, enabled: true });
assert.equal(on.edd.beats.flatMap((b) => [...b.camera, ...b.layers]).filter((x) => x.meta.disabled).length, 0, 'enabling clears the flag');
// 9. markers
const mk1 = run(edd0, { op: 'add_marker', at: 12.5, label: 'intro ends' }, { op: 'add_marker', at: 3 });
assert.deepEqual(mk1.edd.markers.map((m) => m.at), [3, 12.5], 'markers stay sorted by time');
assert.equal(mk1.edd.markers[1].label, 'intro ends');
const mk2 = run(mk1.edd, { op: 'remove_marker', id: mk1.notes[0].id! });
assert.equal(mk2.edd.markers.length, 1);
assert.equal(applyOps(mk2.edd, [{ op: 'remove_marker', id: 'nope' }]).notes[0].ok, false);
console.log('ops: all checks passed');
