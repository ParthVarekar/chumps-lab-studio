import React from 'react';
import { useVideoConfig } from 'remotion';
import { useStudio } from '../../context';

/** Shared dark panel behind technical visuals, so they read over any footage. */
export const Panel: React.FC<{ show: boolean; padding?: number; children: React.ReactNode; title?: string }> = ({ show, padding = 0.02, children, title }) => {
	const { look } = useStudio();
	const { height: H } = useVideoConfig();
	if (!show) return <div style={{ width: '100%', height: '100%', position: 'relative' }}>{children}</div>;
	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				background: 'rgba(16,17,20,0.92)',
				border: '1px solid rgba(255,255,255,0.08)',
				borderRadius: look.cardRadius * H * 1.4,
				boxShadow: look.shadow,
				padding: padding * H,
				boxSizing: 'border-box',
				display: 'flex',
				flexDirection: 'column',
				gap: 0.012 * H,
			}}
		>
			{title ? (
				<div style={{ fontFamily: look.fontBody, fontWeight: 800, fontSize: 0.03 * H, color: look.text, opacity: 0.9 }}>{title}</div>
			) : null}
			<div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{children}</div>
		</div>
	);
};

export const MONO = "'JetBrains Mono', Consolas, monospace";
