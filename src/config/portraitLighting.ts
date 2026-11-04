import {ENVIRONMENTS} from './appearance';
import {assetUrl} from './assets';
import type { PortraitEnvironment } from "../utils/portraitEnvironment";

/** Public R2 address: environment binaries stay outside the application bundle. */
export const DEFAULT_PORTRAIT_ENVIRONMENT: PortraitEnvironment = {
  url: ENVIRONMENTS.find(e=>e.id==='metal-env-1')?.url||assetUrl('/metal_env.exr'), rotation: 0, intensity: 1, photoReflections: true,
};
