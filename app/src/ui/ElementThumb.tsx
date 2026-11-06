import React, { useEffect, useRef, useState } from 'react';
import { StudioProvider } from '@cls/engine/src/context';
import type { Layer } from '@cls/engine/src/edd/schema';
import { Generated } from '@cls/engine/src/element/Element';
import type { ElementSpec } from '@cls/engine/src/element/spec';

const layer = { id: 'thumb', component: 'Generated', props: {}, box: { x: 0, y: 0, w: 20, h: 30, rotation: 0 }, space: 'screen', z: 1, enter: { at: 0, preset: 'cut', direction: 'center', durationFrames: 0 }, meta: { origin: 'ai', locked: false } } as Layer;
const motion = { visible: true, opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, blurX: 0, blurY: 0, progress: 1 };

/** A live preview of an element: still at rest, animating while the pointer is over it (or always, with `live`). */
export const ElementThumb: React.FC<{ spec: ElementSpec; params: Record<string, unknown>; live?: boolean }> = ({ spec, params, live }) => {
	const [t, setT] = useState(1.6);
	const [hover, setHover] = useState(false);
	const start = useRef(0);
	useEffect(() => {
		if (!hover && !live) { setT(1.6); return; }
		start.current = performance.now();
		let raf = 0;
		const tick = () => { setT((performance.now() - start.current) / 1000); raf = requestAnimationFrame(tick); };
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [hover, live]);
	return (
		<div className="ethumb" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
			<StudioProvider look="footage-first" assetBase="">
				<Generated props={{ spec, params }} layer={layer} motion={motion} frame={Math.round(t * 30)} time={t} elapsed={t} length={5} />
			</StudioProvider>
		</div>
	);
};
