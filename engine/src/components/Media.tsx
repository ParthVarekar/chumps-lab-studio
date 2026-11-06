import React from 'react';
import { AnimatedImage, Img, interpolate, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Rect } from '../edd/schema';
import { toFrame } from '../edd/timing';
import { useAsset, useStudio } from '../context';
import type { ComponentProps } from './types';

// ---------------------------------------------------------------- PopImage
export const PopImageProps = z.object({
	src: z.string().describe('project-relative image path (png/jpg/svg/webp)'),
	fit: z.enum(['contain', 'cover']).default('contain'),
	shadow: z.boolean().default(false),
	rounded: z.boolean().default(false),
});

/** A logo, icon, photo or cut-out that pops into place. No frame by default (your style). */
export const PopImage: React.FC<ComponentProps<z.infer<typeof PopImageProps>>> = ({ props }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	return (
		<Img
			src={useAsset(props.src)}
			style={{
				width: '100%',
				height: '100%',
				objectFit: props.fit,
				borderRadius: props.rounded ? look.cardRadius * H : 0,
				filter: props.shadow ? 'drop-shadow(0 0.5vh 1.5vh rgba(0,0,0,0.5))' : undefined,
			}}
		/>
	);
};

// ---------------------------------------------------------------- MemeSticker
export const MemeStickerProps = z.object({
	src: z.string().describe('project-relative animated image (webp/gif/apng/avif), transparent background'),
	credit: z.string().optional().describe('credit line the licence requires, e.g. "Skull emoji by Google Fonts, CC BY 4.0"'),
});

/** An animated reaction sticker (the 💀 😭 🤯 of edit-style memes). Plays from its first frame when the layer enters. */
export const MemeSticker: React.FC<ComponentProps<z.infer<typeof MemeStickerProps>>> = ({ props, layer }) => {
	const { width: W, height: H } = useVideoConfig();
	const w = Math.round((layer.box.w / 100) * W);
	const h = Math.round((layer.box.h / 100) * H);
	return <AnimatedImage src={useAsset(props.src)} width={w} height={h} fit="contain" loopBehavior="loop" style={{ width: '100%', height: '100%' }} />;
};

// ---------------------------------------------------------------- MemeCut
export const MemeCutProps = z.object({
	src: z.string(),
	fit: z.enum(['contain', 'cover']).default('cover'),
	background: z.string().default('#000000'),
});

/** A full-frame meme card. Use with enter preset 'cut' and a full-frame box. */
export const MemeCut: React.FC<ComponentProps<z.infer<typeof MemeCutProps>>> = ({ props }) => (
	<div style={{ width: '100%', height: '100%', background: props.background }}>
		<Img src={useAsset(props.src)} style={{ width: '100%', height: '100%', objectFit: props.fit }} />
	</div>
);

// ---------------------------------------------------------------- EvidenceCard
export const EvidenceCardProps = z.object({
	src: z.string().describe('screenshot of the source being discussed'),
	highlight: Rect.optional().describe('region of the image to highlight, % of the image'),
	highlightDelay: z.number().min(0).default(0.4).describe('seconds after the card lands'),
	highlightColor: z.string().default('accent'),
});

/** A screenshot on a light card; after it lands, a highlighter sweeps across the quoted region. */
export const EvidenceCard: React.FC<ComponentProps<z.infer<typeof EvidenceCardProps>>> = ({ props, layer, frame }) => {
	const { look } = useStudio();
	const { fps, height: H } = useVideoConfig();
	const color = props.highlightColor === 'accent' ? look.accent : props.highlightColor;
	const start = toFrame(layer.enter.at + props.highlightDelay, fps) + layer.enter.durationFrames;
	const sweep = interpolate(frame - start, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const pad = 0.012 * H;
	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				background: '#F4F1EA',
				borderRadius: look.cardRadius * H,
				boxShadow: look.shadow,
				padding: pad,
				boxSizing: 'border-box',
			}}
		>
			<div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: look.cardRadius * H * 0.5 }}>
				<Img src={useAsset(props.src)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
				{props.highlight && sweep > 0 ? (
					<div
						style={{
							position: 'absolute',
							left: `${props.highlight.x}%`,
							top: `${props.highlight.y}%`,
							width: `${props.highlight.w * sweep}%`,
							height: `${props.highlight.h}%`,
							background: color,
							mixBlendMode: 'multiply',
							opacity: 0.55,
						}}
					/>
				) : null}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- ColorChip
export const ColorChipProps = z.object({
	color: z.string(),
	label: z.string().optional(),
});

/** A colour swatch, e.g. when the narration names a colour. */
export const ColorChip: React.FC<ComponentProps<z.infer<typeof ColorChipProps>>> = ({ props }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				background: props.color,
				borderRadius: look.cardRadius * H,
				boxShadow: look.shadow,
				display: 'flex',
				alignItems: 'flex-end',
				justifyContent: 'center',
			}}
		>
			{props.label ? (
				<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: 0.03 * H, color: '#fff', paddingBottom: 0.01 * H }}>{props.label}</span>
			) : null}
		</div>
	);
};
