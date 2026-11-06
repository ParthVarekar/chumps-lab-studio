import type { Edd } from '@cls/engine/src/edd/schema';
import { isContinuation } from '../../shared/ops';

export const stats = (edd: Edd) => {
	const layers = edd.beats.flatMap((b) => b.layers.filter((l) => !isContinuation(l) && !String(l.meta.reason ?? '').startsWith('continues')));
	const cams = edd.beats.flatMap((b) => b.camera);
	return {
		layers: layers.length,
		camera: cams.length,
		sfx: edd.audio.sfx.length,
		locked: layers.filter((l) => l.meta.locked).length + cams.filter((c) => c.meta.locked).length,
		user: layers.filter((l) => l.meta.origin === 'user').length + cams.filter((c) => c.meta.origin === 'user').length,
	};
};
