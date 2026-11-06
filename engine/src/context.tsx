import React, { createContext, useContext, useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import { ensureFonts } from './look/fonts';
import { getLook, type Look } from './look/looks';

/**
 * Project media is served over HTTP by the render script (scripts/lib/media-server.ts), because on
 * Windows Remotion copies its whole public folder into every bundle. EDD paths are project-relative.
 */
export const DEFAULT_ASSET_BASE = 'http://127.0.0.1:7777/';

interface StudioCtx {
	look: Look;
	assetBase: string;
}

const Ctx = createContext<StudioCtx>({ look: getLook('footage-first'), assetBase: DEFAULT_ASSET_BASE });

export const StudioProvider: React.FC<{ look: string; assetBase: string; children: React.ReactNode }> = ({ look, assetBase, children }) => (
	<Ctx.Provider value={{ look: getLook(look), assetBase }}>{children}</Ctx.Provider>
);

export const useStudio = () => useContext(Ctx);

/** Current camera zoom of the beat being rendered (1 = no zoom). */
export const CameraScaleContext = createContext(1);
export const useCameraScale = () => useContext(CameraScaleContext);

/** Resolve a project-relative asset path (forward slashes) to a URL. */
export const useAsset = (src: string): string => {
	const { assetBase } = useStudio();
	if (/^(https?:|data:|blob:)/.test(src)) return src;
	const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
	return base + src.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
};

/**
 * Text is measured to fit its box, so nothing may render before the fonts are loaded: a measurement
 * taken with a fallback font would be cached and the render would differ from run to run.
 */
export const useFontsReady = (): boolean => {
	const [ready, setReady] = useState(false);
	const [handle] = useState(() => delayRender('Loading bundled fonts'));
	useEffect(() => {
		ensureFonts()
			.then(() => {
				setReady(true);
				continueRender(handle);
			})
			.catch((err) => cancelRender(err));
	}, [handle]);
	return ready;
};
