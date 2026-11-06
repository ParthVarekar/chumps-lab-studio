/**
 * Edit Decision Document (EDD) — the single source of truth for an edit.
 *
 * The AI planner writes it, the desktop UI edits it, the renderer turns it into frames.
 * Version 1 uses absolute seconds for timing; word-anchored times (blueprint §5.1) are
 * resolved into seconds before a document reaches the renderer (added in Phase 3).
 *
 * All positions/sizes are percentages of the frame (0–100), so a document renders the
 * same at 720p preview and 1080p final.
 */
import { z } from 'zod';

export const EDD_VERSION = 1 as const;

/** A rectangle in frame percentages. */
export const Rect = z.object({
	x: z.number().min(-50).max(150).describe('left edge, % of frame width'),
	y: z.number().min(-50).max(150).describe('top edge, % of frame height'),
	w: z.number().positive().max(200).describe('width, % of frame width'),
	h: z.number().positive().max(200).describe('height, % of frame height'),
});
export type Rect = z.infer<typeof Rect>;

export const Origin = z.enum(['ai', 'user', 'template']);

export const NodeMeta = z.object({
	origin: Origin.default('ai'),
	locked: z.boolean().default(false).describe('AI passes must never modify a locked node'),
	reason: z.string().optional().describe('one sentence: why this decision exists'),
});
export type NodeMeta = z.infer<typeof NodeMeta>;

export const Direction = z.enum(['left', 'right', 'up', 'down', 'center']);
export type Direction = z.infer<typeof Direction>;

export const EnterPreset = z.enum(['pop', 'slide', 'slide-blur', 'fade', 'drop', 'scale-in', 'typewriter', 'cut']);
export const ExitPreset = z.enum(['fade', 'scale-out', 'slide', 'cut']);

export const Enter = z.object({
	at: z.number().min(0).describe('seconds from the start of the beat'),
	preset: EnterPreset,
	direction: Direction.default('center'),
	durationFrames: z.number().int().min(0).max(120).default(8),
});

export const Exit = z.object({
	at: z.number().min(0).describe('seconds from the start of the beat'),
	preset: ExitPreset.default('fade'),
	durationFrames: z.number().int().min(0).max(60).default(5),
});

/**
 * 'stage' layers live inside the camera (they move and scale with zooms, e.g. a label on a UI
 * element); 'screen' layers sit on top of the camera (titles, pop-ins).
 */
export const Space = z.enum(['stage', 'screen']);

export const Layer = z.object({
	id: z.string(),
	component: z.string().describe('name in the component registry'),
	props: z.record(z.string(), z.unknown()).default({}),
	box: Rect.extend({ rotation: z.number().min(-180).max(180).default(0) }),
	space: Space.default('screen'),
	z: z.number().int().default(10),
	enter: Enter,
	exit: Exit.optional(),
	meta: NodeMeta.default({ origin: 'ai', locked: false }),
});
export type Layer = z.infer<typeof Layer>;

export const CameraMove = z.object({
	at: z.number().min(0).describe('seconds from the start of the beat'),
	to: Rect.describe('the region of the stage that should fill the frame'),
	inFrames: z.number().int().min(1).max(90).default(6),
	hold: z.number().min(0).describe('seconds to hold before returning'),
	outFrames: z.number().int().min(0).max(90).default(10).describe('0 = stay zoomed until the next move or beat end'),
	tiltDeg: z.number().min(-15).max(15).default(0).describe('perspective tilt around the vertical axis'),
	meta: NodeMeta.default({ origin: 'ai', locked: false }),
});
export type CameraMove = z.infer<typeof CameraMove>;

export const MoodKind = z.enum(['anger', 'sad', 'happy', 'shock', 'confusion', 'shake']);

export const Mood = z.object({
	kind: MoodKind,
	at: z.number().min(0),
	duration: z.number().positive().max(20),
	intensity: z.number().min(0).max(1).default(0.6),
	meta: NodeMeta.default({ origin: 'ai', locked: false }),
});
export type Mood = z.infer<typeof Mood>;

export const BaseLayer = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('video'),
		src: z.string().describe('project-relative path'),
		from: z.number().min(0).default(0).describe('seconds into the source file where this beat starts'),
		fit: z.enum(['cover', 'contain']).default('cover'),
	}),
	z.object({ kind: z.literal('image'), src: z.string(), fit: z.enum(['cover', 'contain']).default('cover') }),
	z.object({ kind: z.literal('color'), color: z.string().default('#000000') }),
]);
export type BaseLayer = z.infer<typeof BaseLayer>;

export const Beat = z.object({
	id: z.string(),
	start: z.number().min(0).describe('seconds on the global timeline'),
	end: z.number().positive(),
	narration: z.string().optional(),
	intent: z.string().optional().describe('what the viewer should understand'),
	pacing: z.enum(['dense', 'standard', 'screen-carries']).default('standard'),
	base: BaseLayer,
	camera: z.array(CameraMove).default([]),
	layers: z.array(Layer).default([]),
	moods: z.array(Mood).default([]),
	meta: NodeMeta.default({ origin: 'ai', locked: false }),
});
export type Beat = z.infer<typeof Beat>;

export const AudioClip = z.object({
	src: z.string(),
	start: z.number().min(0).default(0).describe('position on the global timeline, seconds'),
	from: z.number().min(0).default(0).describe('seconds into the source file'),
	volume: z.number().min(0).max(2).default(1),
});

/** A sound effect on the global timeline (whoosh on a zoom, key clicks, a meme's own audio, …). */
export const SfxClip = z.object({
	id: z.string(),
	src: z.string().describe('file under the project folder, e.g. media/sfx/swish-3.wav'),
	at: z.number().min(0).describe('position on the global timeline, seconds'),
	volume: z.number().min(0).max(2).default(0.5).describe('relative to the narration, which is normalised to -14 LUFS'),
	role: z.string().optional().describe('what it is for: whoosh, click, key, pop, meme, …'),
	meta: NodeMeta.default({ origin: 'ai', locked: false }),
});
export type SfxClip = z.infer<typeof SfxClip>;

export const Edd = z
	.object({
		version: z.literal(EDD_VERSION),
		componentLibrary: z.string().describe('e.g. "cls-motion@0.1.0" — pinned for reproducible renders'),
		format: z.object({
			width: z.number().int().min(16).max(7680),
			height: z.number().int().min(16).max(4320),
			fps: z.number().int().min(1).max(120),
		}),
		look: z.string().default('footage-first').describe('name of a look (palette, type, texture)'),
		audio: z.object({
			voice: AudioClip.optional(),
			music: z.array(AudioClip).default([]),
			sfx: z.array(SfxClip).default([]),
		}),
		beats: z.array(Beat).min(1),
	})
	.superRefine((edd, ctx) => {
		edd.beats.forEach((b, i) => {
			if (b.end <= b.start) ctx.addIssue({ code: 'custom', path: ['beats', i, 'end'], message: 'end must be after start' });
			const next = edd.beats[i + 1];
			if (next && Math.abs(next.start - b.end) > 1e-6) {
				ctx.addIssue({ code: 'custom', path: ['beats', i + 1, 'start'], message: 'beats must be contiguous (next.start === prev.end)' });
			}
			const ids = new Set<string>();
			for (const l of b.layers) {
				if (ids.has(l.id)) ctx.addIssue({ code: 'custom', path: ['beats', i, 'layers'], message: `duplicate layer id ${l.id}` });
				ids.add(l.id);
			}
		});
	});
export type Edd = z.infer<typeof Edd>;
export type EddInput = z.input<typeof Edd>;
