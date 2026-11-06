import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { DEFAULT_ASSET_BASE } from './context';
import { DEMO_EDD } from './demo';
import { EddBeat, type EddBeatProps, EddVideo, type EddVideoProps } from './compositions/EddVideo';
import { Edd } from './edd/schema';
import { beatFrameRange, totalFrames } from './edd/timing';

// Placeholders; calculateMetadata replaces them from the document.
const PLACEHOLDER = { durationInFrames: 30, fps: 30, width: 1920, height: 1080 };

const videoMetadata: CalculateMetadataFunction<EddVideoProps> = ({ props }) => {
	const edd = Edd.parse(props.edd);
	return { ...edd.format, durationInFrames: totalFrames(edd), props: { ...props, edd } };
};

const beatMetadata: CalculateMetadataFunction<EddBeatProps> = ({ props }) => {
	const edd = Edd.parse(props.edd);
	const beat = edd.beats[props.beatIndex];
	if (!beat) throw new Error(`beatIndex ${props.beatIndex} out of range (${edd.beats.length} beats)`);
	return { ...edd.format, durationInFrames: beatFrameRange(beat, edd.format.fps).durationInFrames, props: { ...props, edd } };
};

export const RemotionRoot: React.FC = () => (
	<>
		<Composition
			id="EddVideo"
			component={EddVideo}
			{...PLACEHOLDER}
			defaultProps={{ edd: DEMO_EDD, assetBase: DEFAULT_ASSET_BASE }}
			calculateMetadata={videoMetadata}
		/>
		<Composition
			id="EddBeat"
			component={EddBeat}
			{...PLACEHOLDER}
			defaultProps={{ edd: DEMO_EDD, assetBase: DEFAULT_ASSET_BASE, beatIndex: 0 }}
			calculateMetadata={beatMetadata}
		/>
	</>
);
