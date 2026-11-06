import { Generated, GeneratedProps } from '../element/Element';
import { Arrow, ArrowProps, BlurRegion, BlurRegionProps, Captions, CaptionsProps, ClickRipple, ClickRippleProps, FadeBlack, FadeBlackProps, Flash, FlashProps, Glitch, GlitchProps, Highlight, HighlightProps, Letterbox, LetterboxProps, LowerThird, LowerThirdProps, Spotlight, SpotlightProps, StepBadge, StepBadgeProps, Vignette, VignetteProps, Wipe, WipeProps } from './Effects';
import { ColorChip, ColorChipProps, EvidenceCard, EvidenceCardProps, MemeCut, MemeCutProps, MemeSticker, MemeStickerProps, PopImage, PopImageProps } from './Media';
import { BarChart, BarChartProps, Gauge, GaugeProps } from './tech/Charts';
import { CodeBlock, CodeBlockProps, Terminal, TerminalProps } from './tech/Code';
import { NeuralNet, NeuralNetProps } from './tech/NeuralNet';
import { TextBlock, TextProps } from './TextBlock';
import type { ComponentDef } from './types';
import { UILabel, UILabelProps } from './UILabel';

export const COMPONENT_LIBRARY = 'cls-motion@0.3.0';

/**
 * Every component the planner may reference. The planner sees name + description + props schema
 * (exported to JSON Schema); it can't invent components — new ones go through a component request.
 */
export const REGISTRY: Record<string, ComponentDef> = {
	Title: { description: 'Big section title (display font), e.g. slides in with motion blur', props: TextProps, Component: TextBlock },
	KineticWord: { description: 'A single spoken word as big centred type', props: TextProps, Component: TextBlock },
	Header: { description: 'Small persistent step header in the accent colour, e.g. top-left', props: TextProps, Component: TextBlock },
	PopImage: { description: 'Logo / icon / photo / cut-out that illustrates the spoken word', props: PopImageProps, Component: PopImage },
	EvidenceCard: { description: 'Screenshot of a real source on a card, with a highlight sweep on the quoted line', props: EvidenceCardProps, Component: EvidenceCard },
	MemeSticker: { description: 'Animated reaction sticker (💀 😭 🤯 …) that pops in on a meme beat; licensed library only', props: MemeStickerProps, Component: MemeSticker },
	MemeCut: { description: 'Full-frame meme card, usually a hard cut on a punchline', props: MemeCutProps, Component: MemeCut },
	UILabel: { description: 'Label placed on the UI element being explained, with an outline around it', props: UILabelProps, Component: UILabel, space: 'stage' },
	ColorChip: { description: 'Colour swatch when a colour is named', props: ColorChipProps, Component: ColorChip },
	// Technical visuals (Phase 4)
	CodeBlock: { description: 'Syntax-highlighted code on a dark panel; lines appear, key lines get highlighted', props: CodeBlockProps, Component: CodeBlock },
	Terminal: { description: 'A terminal where the command types out and the output appears', props: TerminalProps, Component: Terminal },
	BarChart: { description: 'Animated bar chart comparison (benchmarks, prices, counts) with a highlighted bar', props: BarChartProps, Component: BarChart },
	Gauge: { description: 'Speedometer-style gauge whose needle swings to a value (performance, usage, temperature)', props: GaugeProps, Component: Gauge },
	NeuralNet: { description: 'Neural network diagram that builds layer by layer, then activation pulses flow through it', props: NeuralNetProps, Component: NeuralNet },
	// Effects, transitions, captions, elements (Phase 5)
	Highlight: { description: 'Outline (box, ellipse or underline) that draws itself around a region', props: HighlightProps, Component: Highlight, space: 'stage' },
	Spotlight: { description: 'Dims everything except a region', props: SpotlightProps, Component: Spotlight, space: 'stage' },
	BlurRegion: { description: 'Blurs, frosts or blacks out a region (hide text or faces)', props: BlurRegionProps, Component: BlurRegion, space: 'stage' },
	Arrow: { description: 'Animated arrow pointing at something; rotate the layer to aim it', props: ArrowProps, Component: Arrow, space: 'stage' },
	ClickRipple: { description: 'Click ripple with a cursor, marks where to click', props: ClickRippleProps, Component: ClickRipple, space: 'stage' },
	StepBadge: { description: 'Numbered badge for steps', props: StepBadgeProps, Component: StepBadge, space: 'screen' },
	LowerThird: { description: 'Name / title bar that slides in at the lower left', props: LowerThirdProps, Component: LowerThird, space: 'screen' },
	Flash: { description: 'Quick full-frame flash (cut accent)', props: FlashProps, Component: Flash, space: 'screen' },
	FadeBlack: { description: 'Fade to / from black, or dip through it', props: FadeBlackProps, Component: FadeBlack, space: 'screen' },
	Wipe: { description: 'Colour bar wipes across the frame (transition)', props: WipeProps, Component: Wipe, space: 'screen' },
	Glitch: { description: 'Digital glitch bars (transition / emphasis)', props: GlitchProps, Component: Glitch, space: 'screen' },
	Vignette: { description: 'Darkened edges', props: VignetteProps, Component: Vignette, space: 'screen' },
	Letterbox: { description: 'Cinematic black bars', props: LetterboxProps, Component: Letterbox, space: 'screen' },
	Captions: { description: 'Subtitles from the transcript: pop-word, line or karaoke style', props: CaptionsProps, Component: Captions, space: 'screen' },
	Generated: { description: 'An animated element defined by a spec (speedometer, wifi pulse, plant…), with its own settings', props: GeneratedProps, Component: Generated, space: 'screen' },
};
