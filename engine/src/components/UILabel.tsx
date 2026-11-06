import React from 'react';
import { interpolate, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Rect } from '../edd/schema';
import { useCameraScale, useStudio } from '../context';
import type { ComponentProps } from './types';

export const UILabelProps = z.object({
	text: z.string().min(1),
	target: Rect.describe('the UI element being explained, in stage %'),
	// White by default: yellow is the step-header colour in this style, and a yellow label next to a
	// yellow header reads as one more header (run 3 finding).
	color: z.string().default('text'),
});

/**
 * A label placed on the UI element it explains (your "Windows 10 written into the layout tile"
 * device). The layer's box is the label pill; the outline traces `target`. Use space 'stage' so
 * both follow camera zooms.
 */
export const UILabel: React.FC<ComponentProps<z.infer<typeof UILabelProps>>> = ({ props, layer, motion }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	const color = ({ text: look.text, accent: look.accent, accent2: look.accent2 } as Record<string, string>)[props.color] ?? props.color;
	const { box } = layer;
	const t = props.target;
	const draw = interpolate(motion.progress, [0, 1], [0, 1], { extrapolateRight: 'clamp' });
	// The outline follows the zoom (it marks a UI element); the pill and the stroke keep a fixed
	// on-screen size, otherwise a 2.5x zoom turns the label into a giant banner.
	const zoom = useCameraScale();
	const stroke = (0.0045 * H) / zoom;
	// Target outline in the label's own coordinate space (percent of the label box).
	const outline: React.CSSProperties = {
		position: 'absolute',
		left: `${((t.x - box.x) / box.w) * 100}%`,
		top: `${((t.y - box.y) / box.h) * 100}%`,
		width: `${(t.w / box.w) * 100}%`,
		height: `${(t.h / box.h) * 100}%`,
		border: `${stroke}px solid ${color}`,
		borderRadius: 0.008 * H,
		boxSizing: 'border-box',
		opacity: draw,
		transform: `scale(${1.06 - 0.06 * draw})`,
	};
	const fontSize = Math.min(((box.h / 100) * H) * 0.6, look.labelSize * H);
	return (
		<div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'visible' }}>
			<div style={outline} />
			<div
				style={{
					width: '100%',
					height: '100%',
					background: color,
					borderRadius: 0.01 * H,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					boxShadow: look.shadow,
					transform: `scale(${1 / zoom})`,
					transformOrigin: '50% 0%',
				}}
			>
				<span style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize, color: '#0B0B0C', whiteSpace: 'nowrap' }}>{props.text}</span>
			</div>
		</div>
	);
};
