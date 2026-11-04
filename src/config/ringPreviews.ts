import type { EngravingPosition } from "./engraving";
import type { PortraitFit } from "./portraitFit";
import type { PortraitEnvironment } from "../utils/portraitEnvironment";

// Keep gallery metadata independent of WebGI so the product page can render
// while the 3D engine downloads in its own chunk.
export type RingPreviewImage = { id: string; label: string; url: string; width?: number; height?: number; engravingPosition?: EngravingPosition };
export type RingDetailPreviewRequest = { key: string; viewId: string; resolution: number; engravingPosition?: EngravingPosition; portraitFit?: PortraitFit; environment?: PortraitEnvironment };
export const RING_PREVIEW_RESOLUTION = 1200;
export const RING_PREVIEW_VERSION = "studio-1200-balanced-resting-v17";
/** Inside-band inscriptions are invisible in portraits. Reuse those images
 * across engraving edits, while retaining every visible ring/lighting choice. */
export const getPortraitPreviewKey = (design: {
  headFile: string; shankFile: string; headScale: number; shankScale: number;
  headMetalHex: string; shankMetalHex: string;
}, environment?: PortraitEnvironment) => JSON.stringify([
  RING_PREVIEW_VERSION, "portrait", design.headFile, design.shankFile,
  design.headScale, design.shankScale, design.headMetalHex, design.shankMetalHex,
  environment ?? null,
]);
export const getRingDetailResolution = () => {
  const mobile = window.innerWidth <= 768;
  const constrained = (navigator.hardwareConcurrency || 4) <= 8;
  const required = Math.ceil(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.8) * Math.min(window.devicePixelRatio || 1, 2) * 3 / 256) * 256;
  return Math.min(constrained ? 1792 : 2048, Math.max(mobile ? 1600 : 1792, required));
};
export const RING_PREVIEW_VIEWS = [
  { id: "three-quarter", label: "Three-quarter view", direction: [0.8, 0.4, -1], up: [0, 1, 0], lying: false },
  { id: "top", label: "Diamond view", direction: [1, 0.16, 0], up: [0, 1, 0], lying: true },
  { id: "profile", label: "Side profile", direction: [0.08, 0.38, 1], up: [0, 1, 0], lying: true },
] as const;
export const getRingPreviewViews = (engraved: boolean) => engraved
  ? [...RING_PREVIEW_VIEWS.slice(0, 2), { ...RING_PREVIEW_VIEWS[2], id: "engraving", label: "Engraving detail" }]
  : [...RING_PREVIEW_VIEWS];
