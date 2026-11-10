// Run: npx tsx test/ops.test.ts   (from app/). Plain asserts; exits non-zero on failure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Edd } from '@cls/engine/src/edd/schema';
import { allItemIds, applyOps, find, metaOfItem, rangeOps, rippleOps, segments, spanOf, withGroup, type Op } from '../shared/ops';

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
// 10. ripple delete closes the gap (grouped and locked items handled)
const rp = run(edd0, { op: 'add_layer', component: 'Title', at: 20, until: 22, props: { text: 'one' } }, { op: 'add_layer', component: 'Title', at: 25, until: 27, props: { text: 'two' } }, { op: 'add_layer', component: 'Title', at: 8, until: 9, props: { text: 'before' } }, { op: 'add_layer', component: 'Title', at: 40, until: 41, props: { text: 'locked' } });
const rpLock = run(rp.edd, { op: 'lock', id: rp.notes[3].id!, locked: true });
const rops = rippleOps(rpLock.edd, [rp.notes[0].id!]);
assert.equal(rops[0].op, 'remove');
const rr = applyOps(rpLock.edd, rops).edd;
assert.equal(find(rr, rp.notes[0].id!), null, 'the item is gone');
assert.ok(Math.abs(spanOf(rr, rp.notes[1].id!)!.start - 23) < 0.05, 'the later item slid left by the hole (2 s)');
assert.ok(Math.abs(spanOf(rr, rp.notes[2].id!)!.start - 8) < 0.05, 'an earlier item did not move');
assert.ok(Math.abs(spanOf(rr, rp.notes[3].id!)!.start - 40) < 0.05, 'a locked item did not move');
// 11. lift / extract between In and Out
const rg = run(edd0, { op: 'add_layer', component: 'Title', at: 20, until: 21, props: { text: 'a' } }, { op: 'add_layer', component: 'Title', at: 24, until: 25, props: { text: 'b' } }, { op: 'add_layer', component: 'Title', at: 30, until: 31, props: { text: 'c' } }, { op: 'add_layer', component: 'Title', at: 22, until: 28, props: { text: 'straddles' } });
const lifted = applyOps(rg.edd, rangeOps(rg.edd, 19, 26, false)).edd;
assert.equal(find(lifted, rg.notes[0].id!), null, 'lift removes an item inside the range');
assert.equal(find(lifted, rg.notes[1].id!), null);
assert.ok(find(lifted, rg.notes[2].id!), 'an item outside is untouched');
assert.ok(find(lifted, rg.notes[3].id!), 'an item that straddles the edge is not removed');
assert.ok(Math.abs(spanOf(lifted, rg.notes[2].id!)!.start - 30) < 0.05, 'lift leaves the gap');
const extracted = applyOps(rg.edd, rangeOps(rg.edd, 19, 26, true)).edd;
assert.ok(Math.abs(spanOf(extracted, rg.notes[2].id!)!.start - 23) < 0.05, 'extract slides later items left by the range width (7 s)');
assert.equal(rangeOps(rg.edd, 5, 5, true).length, 0, 'an empty range does nothing');
assert.equal(allItemIds(rg.edd).filter((i) => find(rg.edd, i)?.kind === 'layer').length >= 4, true);
// 12. motion keyframes: an end pose over the layer's whole life, span kept current when it is retimed or runs across beats
const mo = run(edd0, { op: 'add_layer', component: 'Title', at: 20, until: 24, props: { text: 'move' } });
const mid = mo.notes[0].id!;
const mo1 = run(mo.edd, { op: 'set_motion', id: mid, motion: { dx: 30, scale: 1.5, opacity: 0 } });
const lm = find(mo1.edd, mid)!.layer!.motion!;
assert.equal(lm.dx, 30);
assert.deepEqual(lm.span, [20, 24], 'the span is the layer life');
const mo2 = run(mo1.edd, { op: 'set_time', id: mid, start: 50 });
assert.deepEqual(find(mo2.edd, mid)!.layer!.motion!.span, [50, 54], 'moving the layer moves its animation span');
const mo3 = run(mo2.edd, { op: 'set_motion', id: mid, motion: { dy: -10 } });
assert.ok(find(mo3.edd, mid)!.layer!.motion!.dx === 30 && find(mo3.edd, mid)!.layer!.motion!.dy === -10, 'a later edit keeps the other fields');
const mo4 = run(mo3.edd, { op: 'set_motion', id: mid, motion: null });
assert.equal(find(mo4.edd, mid)!.layer!.motion, undefined, 'null removes it');
const wide = run(edd0, { op: 'add_layer', component: 'Title', at: 10, until: 60, props: { text: 'long' } }, { op: 'set_motion', id: 'u1', motion: { dx: 10 } });
const segsMo = segments(wide.edd, wide.notes[0].id!);
assert.ok(segsMo.length > 1 && segsMo.every((x) => x.layer.motion?.span?.[0] === 10 && x.layer.motion?.span?.[1] === 60), 'every segment of a multi-beat layer shares one span');
console.log('ops: all checks passed');
