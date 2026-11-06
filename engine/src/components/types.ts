import type React from 'react';
import type { z } from 'zod';
import type { Layer } from '../edd/schema';
import type { MotionState } from '../motion/enter';

export interface ComponentProps<P> {
	props: P;
	layer: Layer;
	motion: MotionState;
	/** Frame number counted from the start of the beat. */
	frame: number;
	/** Global time in seconds (beat start + frame). */
	time: number;
	/** Seconds since this layer (or this segment of it) appeared. */
	elapsed: number;
	/** Seconds this layer is visible in this beat (to its exit, or the end of the beat). */
	length: number;
}

export interface ComponentDef {
	description: string;
	props: z.ZodType;
	Component: React.FC<ComponentProps<any>>;
	/** Default space for this component when the planner doesn't say. */
	space?: 'stage' | 'screen';
}
