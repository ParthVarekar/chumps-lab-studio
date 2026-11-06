// Settings for `remotion studio` / CLI renders. The scripts in scripts/ pass the same options explicitly.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setChromiumOpenGlRenderer('angle');
Config.setOverwriteOutput(true);
