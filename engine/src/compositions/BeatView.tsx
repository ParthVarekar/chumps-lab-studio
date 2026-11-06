import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { REGISTRY } from '../components/registry';
import { CameraScaleContext, useAsset, useStudio } from '../context';
import type { BaseLayer, Beat, Layer } from '../edd/schema';
import { toFrame } from '../edd/timing';
import { cameraAt } from '../motion/camera';
import { layerMotion } from '../motion/enter';
import { moodEffects } from '../motion/moods';

const Base: React.FC<{ base: BaseLayer }> = ({ base }) => {
	const { fps } = useVideoConfig();
	const src = useAsset('src' in base ? base.src : '');
	if (base.kind === 'color') return <AbsoluteFill style={{ backgroundColor: base.color }} />;
	if (base.kind === 'image') return <Img src={src} style={{ width: '100%', height: '100%', objectFit: base.fit }} />;
	return <OffthreadVideo src={src} muted trimBefore={toFrame(base.from, fps)} style={{ width: '100%', height: '100%', objectFit: base.fit }} />;
};

const InvalidLayer: React.FC<{ layer: Layer; message: string }> = ({ layer, message }) => (
	<div
		data-edd-id={layer.id}
		data-edd-error={message}
		style={{
			position: 'absolute', left: `${layer.box.x}%`, top: `${layer.box.y}%`, width: `${layer.box.w}%`, height: `${layer.box.h}%`,
			border: '4px dashed #ff2d55', color: '#ff2d55', font: '600 20px Inter', padding: 8, boxSizing: 'border-box', background: 'rgba(0,0,0,0.6)',
		}}
	>
		{layer.component}: {message}
	</div>
);

/** One layer: positions its box, applies entrance/exit motion and motion blur, renders the component. */
const LayerView: React.FC<{ layer: Layer; frame: number; beat: Beat }> = ({ layer, frame, beat }) => {
	const { fps, width: W, height: H } = useVideoConfig();
	const def = REGISTRY[layer.component];
	if (!def) return <InvalidLayer layer={layer} message="unknown component" />;
	const parsed = def.props.safeParse(layer.props);
	if (!parsed.success) return <InvalidLayer layer={layer} message={parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')} />;

	const m = layerMotion(layer, frame, fps, W, H);
	if (!m.visible) return null;
	const blur = m.blurX > 0.5 || m.blurY > 0.5;
	const filterId = `mb-${layer.id}`;
	const Comp = def.Component;
	const elapsed = (frame - toFrame(layer.enter.at, fps)) / fps;
	const length = (layer.exit ? layer.exit.at + layer.exit.durationFrames / fps : beat.end - beat.start) - layer.enter.at;
	return (
		<div
			data-edd-id={layer.id}
			style={{
				position: 'absolute',
				left: `${layer.box.x}%`,
				top: `${layer.box.y}%`,
				width: `${layer.box.w}%`,
				height: `${layer.box.h}%`,
				zIndex: layer.z,
				opacity: m.opacity,
				transform: `translate(${m.tx}px, ${m.ty}px) rotate(${layer.box.rotation + m.rotate}deg) scale(${m.scale})`,
				filter: blur ? `url(#${filterId})` : undefined,
			}}
		>
			{blur ? (
				<svg width={0} height={0} style={{ position: 'absolute' }}>
					<filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur stdDeviation={`${m.blurX} ${m.blurY}`} />
					</filter>
				</svg>
			) : null}
			<Comp props={parsed.data} layer={layer} motion={m} frame={frame} time={beat.start + frame / fps} elapsed={elapsed} length={length} />
		</div>
	);
};

/**
 * Renders one beat at the current (beat-local) frame:
 *   mood wrapper → camera tilt → camera stage [base + 'stage' layers] → 'screen' layers → mood overlays
 */
export const BeatView: React.FC<{ beat: Beat }> = ({ beat }) => {
	const frame = useCurrentFrame();
	const { fps, width: W, height: H } = useVideoConfig();
	const { look } = useStudio();
	const cam = cameraAt(beat.camera, frame, fps, W, H);
	const mood = moodEffects(beat.moods, frame, fps, W, beat.id);
	const byZ = (a: Layer, b: Layer) => a.z - b.z;
	const stage = beat.layers.filter((l) => l.space === 'stage').sort(byZ);
	const screen = beat.layers.filter((l) => l.space === 'screen').sort(byZ);

	return (
		<AbsoluteFill style={{ backgroundColor: look.background, overflow: 'hidden' }}>
			<AbsoluteFill style={{ transform: mood.transform, filter: mood.filter }}>
				<AbsoluteFill style={{ transform: cam.tilt, transformOrigin: '50% 50%' }}>
					<AbsoluteFill style={{ transform: cam.transform, transformOrigin: '0 0', filter: cam.blur > 0.4 ? `blur(${cam.blur.toFixed(2)}px)` : undefined }}>
						<Base base={beat.base} />
						<CameraScaleContext.Provider value={cam.scale}>
							{stage.map((l) => <LayerView key={l.id} layer={l} frame={frame} beat={beat} />)}
						</CameraScaleContext.Provider>
					</AbsoluteFill>
				</AbsoluteFill>
				{screen.map((l) => <LayerView key={l.id} layer={l} frame={frame} beat={beat} />)}
				{mood.overlays}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
