import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { StudioProvider, useAsset, useFontsReady } from '../context';
import type { Edd } from '../edd/schema';
import { beatFrameRange, toFrame } from '../edd/timing';
import { BeatView } from './BeatView';

export interface EddVideoProps extends Record<string, unknown> {
	edd: Edd;
	assetBase: string;
}

export interface EddBeatProps extends EddVideoProps {
	beatIndex: number;
}

const Voice: React.FC<{ edd: Edd }> = ({ edd }) => {
	const { fps } = useVideoConfig();
	const v = edd.audio.voice;
	const src = useAsset(v?.src ?? '');
	if (!v) return null;
	return (
		<Sequence from={toFrame(v.start, fps)}>
			<Audio src={src} trimBefore={toFrame(v.from, fps)} volume={v.volume} />
		</Sequence>
	);
};

/** One sound effect, for the editor's preview and one-shot renders. (The beat-by-beat render mixes them in ffmpeg.) */
const SfxClip: React.FC<{ id: string; src: string; at: number; volume: number }> = ({ src, at, volume }) => {
	const { fps } = useVideoConfig();
	const url = useAsset(src);
	return (
		<Sequence from={toFrame(at, fps)} durationInFrames={Math.round(fps * 4)} layout="none">
			<Audio src={url} volume={Math.min(1, volume)} />
		</Sequence>
	);
};

const Sfx: React.FC<{ edd: Edd }> = ({ edd }) => (
	<>
		{edd.audio.sfx.filter((c) => !c.meta.disabled).map((c) => (
			<SfxClip key={c.id} id={c.id} src={c.src} at={c.at} volume={c.volume} />
		))}
	</>
);

/** The whole edit: every beat in sequence plus the narration. Used for preview and one-shot renders. */
export const EddVideo: React.FC<EddVideoProps> = ({ edd, assetBase }) => {
	const ready = useFontsReady();
	const { fps } = useVideoConfig();
	return (
		<StudioProvider look={edd.look} assetBase={assetBase}>
			<AbsoluteFill style={{ backgroundColor: '#000' }}>
				{ready
					? edd.beats.map((b) => {
							const r = beatFrameRange(b, fps);
							return (
								<Sequence key={b.id} from={r.from} durationInFrames={r.durationInFrames} name={b.id}>
									<BeatView beat={b} />
								</Sequence>
							);
						})
					: null}
				<Voice edd={edd} />
				<Sfx edd={edd} />
			</AbsoluteFill>
		</StudioProvider>
	);
};

/** A single beat, video only. The render pipeline renders beats separately so they can be cached. */
export const EddBeat: React.FC<EddBeatProps> = ({ edd, assetBase, beatIndex }) => {
	const ready = useFontsReady();
	return (
		<StudioProvider look={edd.look} assetBase={assetBase}>
			<AbsoluteFill style={{ backgroundColor: '#000' }}>{ready ? <BeatView beat={edd.beats[beatIndex]} /> : null}</AbsoluteFill>
		</StudioProvider>
	);
};
