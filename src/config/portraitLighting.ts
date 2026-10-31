import environmentUrl from "../assets/environments/portrait-metal-env-1.hdr?url";
import type { PortraitEnvironment } from "../utils/portraitEnvironment";

/** Bundled with the application so portrait lighting also works after build. */
export const DEFAULT_PORTRAIT_ENVIRONMENT: PortraitEnvironment = {
  url: environmentUrl, rotation: 0, intensity: 1, photoReflections: true,
};
