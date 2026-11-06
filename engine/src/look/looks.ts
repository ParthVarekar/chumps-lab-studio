/**
 * A "look" is the small set of design tokens a whole video shares (blueprint §5.8):
 * one neutral, one text colour, at most two accents, at most two type families.
 * Sizes are fractions of the frame height so every resolution matches.
 */
export interface Look {
	name: string;
	background: string;
	text: string;
	/** Outline drawn behind text so it reads over any footage (0 = none). Fraction of font size. */
	textStroke: number;
	strokeColor: string;
	accent: string;
	accent2: string;
	fontDisplay: string;
	fontBody: string;
	/** Cap-height-ish sizes as a fraction of frame height. */
	titleSize: number;
	labelSize: number;
	cardRadius: number; // fraction of frame height
	shadow: string;
}

export const LOOKS: Record<string, Look> = {
	// Your Linux-video style: white heavy type with a dark outline straight over the footage.
	'footage-first': {
		name: 'footage-first',
		background: '#000000',
		text: '#FFFFFF',
		textStroke: 0.14,
		strokeColor: '#0B0B0C',
		accent: '#FFD60A',
		accent2: '#FF453A',
		fontDisplay: 'Archivo Black',
		fontBody: 'Inter',
		titleSize: 0.105,
		labelSize: 0.045,
		cardRadius: 0.012,
		shadow: '0 0.6vh 2.4vh rgba(0,0,0,0.45)',
	},
	// Fireship-like evidence look: near-black, off-white cards, one hot accent.
	'terminal-noir': {
		name: 'terminal-noir',
		background: '#0A0A0B',
		text: '#F4F1EA',
		textStroke: 0,
		strokeColor: '#000000',
		accent: '#FF6A13',
		accent2: '#E5383B',
		fontDisplay: 'Archivo Black',
		fontBody: 'Inter',
		titleSize: 0.09,
		labelSize: 0.04,
		cardRadius: 0.008,
		shadow: '0 0.8vh 3vh rgba(0,0,0,0.6)',
	},
};

export const getLook = (name: string): Look => LOOKS[name] ?? LOOKS['footage-first'];
