import { fitText } from '@remotion/layout-utils';
import React from 'react';
import { useVideoConfig } from 'remotion';
import { z } from 'zod';
import { useStudio } from '../context';
import type { ComponentProps } from './types';

export const TextProps = z.object({
	text: z.string().min(1),
	variant: z.enum(['title', 'word', 'header', 'label']).default('title'),
	align: z.enum(['left', 'center', 'right']).default('center'),
	color: z.string().default('text').describe("'text' | 'accent' | 'accent2' or a CSS colour"),
	uppercase: z.boolean().default(false),
});

/**
 * Titles, single kinetic words, section headers and labels. The font size is the largest that fits
 * the layer's box (width via measured text, height via box height), so planners only choose boxes.
 */
export const TextBlock: React.FC<ComponentProps<z.infer<typeof TextProps>>> = ({ props, layer, motion }) => {
	const { look } = useStudio();
	const { width: W, height: H } = useVideoConfig();
	const boxW = (layer.box.w / 100) * W;
	const boxH = (layer.box.h / 100) * H;

	const display = props.variant === 'title' || props.variant === 'word';
	const fontFamily = display ? look.fontDisplay : look.fontBody;
	const fontWeight = display ? '400' : '800';
	const text = props.uppercase ? props.text.toUpperCase() : props.text;
	const color = { text: look.text, accent: look.accent, accent2: look.accent2 }[props.color] ?? props.color;

	const fitted = fitText({ text, withinWidth: boxW * 0.96, fontFamily, fontWeight });
	const fontSize = Math.min(fitted.fontSize, boxH * 0.78);
	const stroke = props.variant === 'header' ? 0 : look.textStroke * fontSize;

	// Typewriter reveal (other presets have progress 1 after their entrance).
	const shown = layer.enter.preset === 'typewriter' ? text.slice(0, Math.ceil(text.length * motion.progress)) : text;

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: props.align === 'left' ? 'flex-start' : props.align === 'right' ? 'flex-end' : 'center',
			}}
		>
			<span
				style={{
					fontFamily,
					fontWeight: Number(fontWeight),
					fontSize,
					lineHeight: 1,
					color,
					whiteSpace: 'pre',
					letterSpacing: display ? '-0.01em' : '0',
					WebkitTextStroke: stroke ? `${stroke}px ${look.strokeColor}` : undefined,
					paintOrder: 'stroke fill',
				}}
			>
				{shown}
			</span>
		</div>
	);
};
