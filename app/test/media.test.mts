// Project setup and media bin, through the real HTTP API. Needs the studio server running.
//   node ../node_modules/tsx/dist/cli.mjs test/media.test.mts
// Makes a throwaway project and a 3 s test clip with ffmpeg, then deletes the project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:4173';
const H = { 'X-Studio': '1' };
const j = async (p: string, body?: unknown) => {
	const r = await fetch(`${BASE}${p}`, { method: body ? 'POST' : 'GET', headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
	return { status: r.status, body: (await r.json()) as any };
};

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cls-media-'));
const clip = path.join(tmp, 'test clip.mp4');
const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
assert.equal(ff.status, 0, 'ffmpeg could make a test clip');

const name = `Media Test ${Date.now().toString(36)}`;
let dir = '';
try {
	// 1. new project with its own sequence settings
	const bad = await j('/api/projects/new', { name: '   ' });
	assert.equal(bad.status, 400, 'an empty name is refused');
	const created = await j('/api/projects/new', { name, width: 1080, height: 1920, fps: 60 });
	assert.equal(created.status, 200, JSON.stringify(created.body));
	dir = created.body.dir;
	assert.equal((await j('/api/projects/new', { name })).status, 400, 'a duplicate name is refused');
	const opened = await j('/api/open', { dir });
	assert.deepEqual(opened.body.edd.format, { width: 1080, height: 1920, fps: 60 }, 'the sequence settings are kept');
	assert.equal(opened.body.edd.beats.length, 1, 'a new project starts with one empty placeholder beat');

	// 2. upload (streamed), then it shows up in the bin with probe data and a thumbnail
	const up = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent('test clip.mp4')}`, { method: 'POST', headers: H, body: readFileSync(clip) });
	const item = (await up.json()) as any;
	assert.equal(up.status, 200, JSON.stringify(item));
	assert.equal(item.kind, 'video');
	assert.ok(Math.abs(item.duration - 3) < 0.3 && item.width === 640 && item.height === 360 && item.hasAudio === true, JSON.stringify(item));
	assert.ok(item.thumb && existsSync(path.join(dir, item.thumb)), 'a poster thumbnail was made');
	const up2 = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent('test clip.mp4')}`, { method: 'POST', headers: H, body: readFileSync(clip) });
	assert.equal(((await up2.json()) as any).name, 'test clip (2).mp4', 'a second file with the same name does not overwrite the first');
	const evil = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent('..\\..\\evil.mp4')}`, { method: 'POST', headers: H, body: readFileSync(clip) });
	const evilItem = (await evil.json()) as any;
	assert.ok(!/[\\/]/.test(evilItem.name ?? '') && existsSync(path.join(dir, 'media', evilItem.name)), 'a path in the file name is flattened into media/');
	const exe = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent(dir)}&name=run.exe`, { method: 'POST', headers: H, body: Buffer.from('MZ') });
	assert.equal(exe.status, 400, 'only media file types are accepted');
	const outside = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent('C:/Windows')}&name=a.mp4`, { method: 'POST', headers: H, body: readFileSync(clip) });
	assert.equal(outside.status, 400, 'uploads only go into studio projects');
	const noHeader = await fetch(`${BASE}/api/media/upload?dir=${encodeURIComponent(dir)}&name=a.mp4`, { method: 'POST', body: readFileSync(clip) });
	assert.equal(noHeader.status, 403, 'the studio header is required');
	const list = await j(`/api/media?dir=${encodeURIComponent(dir)}`);
	assert.equal(list.body.items.length, 3, 'the bin lists what was uploaded (and nothing else)');

	// 3. put it on the sequence: the placeholder is replaced, the clip's audio becomes the main audio
	const add = await j('/api/ops', { dir, author: 'user', ops: [{ op: 'add_footage', src: item.path, duration: item.duration, kind: 'video', has_audio: true }] });
	assert.equal(add.body.notes[0].ok, true, JSON.stringify(add.body.notes));
	let e = (await j('/api/open', { dir })).body.edd;
	assert.equal(e.beats.length, 1);
	assert.equal(e.beats[0].base.src, item.path);
	assert.ok(Math.abs(e.beats[0].end - item.duration) < 0.01);
	assert.equal(e.audio.voice?.src, item.path, 'the first clip with sound becomes the main audio');
	// a second, long clip is cut into ~20 s beats and its audio arrives as a sound item
	const long = await j('/api/ops', { dir, author: 'user', ops: [{ op: 'add_footage', src: item.path, duration: 50, kind: 'video', has_audio: true }, { op: 'add_footage', src: item.path, duration: 4, kind: 'image' }] });
	assert.ok(long.body.notes.every((n: any) => n.ok), JSON.stringify(long.body.notes));
	e = (await j('/api/open', { dir })).body.edd;
	assert.equal(e.beats.length, 1 + 2 + 1, '3 s + (20 s + 30 s) + a 4 s image');
	assert.ok(e.beats.every((b: any, i: number) => i === 0 || Math.abs(b.start - e.beats[i - 1].end) < 1e-6), 'beats are contiguous');
	assert.equal(e.audio.sfx.filter((s: any) => s.role === 'clip audio').length, 1, "the later clip's own sound is a sound item at its start");
	assert.ok(Math.abs(e.audio.sfx[0].at - 3) < 0.01);

	// 4. settings and guards
	const fmt = await j('/api/ops', { dir, author: 'user', ops: [{ op: 'set_format', width: 1280, height: 720, fps: 24 }] });
	assert.equal(fmt.body.notes[0].ok, true);
	assert.deepEqual((await j('/api/open', { dir })).body.edd.format, { width: 1280, height: 720, fps: 24 });
	const used = await j('/api/media/delete', { dir, name: 'test clip.mp4' });
	assert.equal(used.status, 400, 'a file that is used in the edit cannot be deleted');
	const free = await j('/api/media/delete', { dir, name: 'test clip (2).mp4' });
	assert.equal(free.status, 200);
	assert.equal((await j(`/api/media?dir=${encodeURIComponent(dir)}`)).body.items.length, 2);
	const badPath = await j('/api/ops', { dir, author: 'user', ops: [{ op: 'add_footage', src: '../../secret.mp4', duration: 3 }] });
	assert.equal(badPath.body.notes[0].ok, false, 'footage must live in media/');
	console.log('media: all checks passed');
} finally {
	if (dir && dir.includes(`${path.sep}projects${path.sep}Media-Test-`)) rmSync(dir, { recursive: true, force: true });
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
