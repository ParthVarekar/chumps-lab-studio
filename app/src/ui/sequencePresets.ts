/** Sequence presets, as in Premiere's New Sequence dialog. Used by New Project and Project Settings. */
export interface SequencePreset { id: string; label: string; width: number; height: number; fps: number }

export const SEQUENCE_PRESETS: SequencePreset[] = [
	{ id: 'hd30', label: 'YouTube 1080p, 30 fps', width: 1920, height: 1080, fps: 30 },
	{ id: 'hd60', label: 'YouTube 1080p, 60 fps', width: 1920, height: 1080, fps: 60 },
	{ id: 'uhd30', label: '4K UHD, 30 fps', width: 3840, height: 2160, fps: 30 },
	{ id: 'hd24', label: 'Cinema 1080p, 24 fps', width: 1920, height: 1080, fps: 24 },
	{ id: 'vertical', label: 'Shorts / Reels / TikTok 1080x1920, 30 fps', width: 1080, height: 1920, fps: 30 },
	{ id: 'square', label: 'Square 1080x1080, 30 fps', width: 1080, height: 1080, fps: 30 },
	{ id: 'hd720', label: '720p, 30 fps', width: 1280, height: 720, fps: 30 },
];

export const presetFor = (w: number, h: number, fps: number) => SEQUENCE_PRESETS.find((p) => p.width === w && p.height === h && p.fps === fps)?.id ?? 'custom';
