import library from "./environmentLibrary.json" with { type: "json" };
import presets from "./thumbnailPresets.json" with { type: "json" };
import type { BuilderAppearance, EnvironmentChoice, ThumbnailChoice } from "../types/appearance";
import { assetUrl } from "./assets.js";
export const ENVIRONMENTS = library as { id: string; name: string; url: string; preview: string }[];
export const THUMBNAIL_PRESETS = presets as { id: string; name: string; caption: string; preview: string; [key: string]: unknown }[];
export const DEFAULT_APPEARANCE: BuilderAppearance = {
  thumbnails: { mode: "preset", preset: "D", metal: "silver", environment: { id: "metal-env-1", rotation: 0, intensity: 1 } },
  studio: { id: "default", rotation: 0, intensity: 1 }, portraits: { id: "metal-env-1", rotation: 0, intensity: 1 },
};
export const getAppearance = (value?: BuilderAppearance): BuilderAppearance => value || DEFAULT_APPEARANCE;
export const thumbnailSignature = (value: ThumbnailChoice) => JSON.stringify([value.mode,value.preset,value.metal,value.environment.id,value.environment.rotation,value.environment.intensity]);
export const modelThumbnailKey = (file: string, kind: "head" | "shank") => `${kind}:${file}`;
export const studioEnvironment = (value: EnvironmentChoice) => ({
  url: ENVIRONMENTS.find(item => item.id === value.id)?.url || assetUrl("/metal_env.exr"),
  rotation: value.rotation * Math.PI / 180, intensity: value.intensity, photoReflections: false,
});
// The portrait capture/test controls use degrees; the live scene uses radians.
export const portraitEnvironment = (value: EnvironmentChoice) => ({ ...studioEnvironment(value), rotation: value.rotation, photoReflections: true });
export const THUMBNAIL_METALS = { silver: "#C2C2C3", gold: "#E3BB5E", rose: "#D9A483" };
