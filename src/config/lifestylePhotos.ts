import darkPortrait from "../assets/lifestyle/dark-chin-v14.png";
import fairPortrait from "../assets/lifestyle/fair-chin-v14.png";
import lighterPortrait from "../assets/lifestyle/lighter-user-crop-v9.png";
import type { PortraitFit } from "./portraitFit";

// Accepted manual calibration for all three hand-under-chin portraits.
// Revisioned IDs invalidate composites when the defaults change.
export const LIFESTYLE_PHOTOS = [
  {
    key: "dark", id: "lifestyle-dark-chin-v16", label: "Dark portrait", image: darkPortrait,
    center: [.605, .6105], fingerWidth: .0775, angle: -42,
    tilt: -7, roll: -3.5, fingerRadiusScale: 1.01, zTurn: -3.5,
    crop: { left: .23, top: .16, size: .68 },
    flipX: false,
  },
  {
    key: "fair", id: "lifestyle-fair-chin-v16", label: "Fair portrait", image: fairPortrait,
    center: [.607, .6105], fingerWidth: .0785, angle: -42,
    tilt: -7, roll: -3.5, fingerRadiusScale: 1.01, zTurn: -3.5,
    crop: { left: .23, top: .16, size: .68 },
    flipX: false,
  },
  {
    key: "lighter", id: "lifestyle-lighter-user-crop-v16", label: "Lighter portrait", image: lighterPortrait,
    center: [.6022, .6105], fingerWidth: .0795, angle: -42,
    tilt: -7, roll: -3.5, fingerRadiusScale: 1.01, zTurn: -3.5,
    crop: { left: .23, top: .16, size: .68 }, flipX: false,
  },
] as const satisfies readonly (PortraitFit & { key: string; id: string; label: string; image: string; crop: { left: number; top: number; size: number }; flipX: boolean })[];
export const isLifestyleView = (id: string) => LIFESTYLE_PHOTOS.some(photo => photo.id === id);
// Portraits render individually on demand, with extra samples where the ring needs
// more pixels than a full-ring studio photograph.
export const LIFESTYLE_PREVIEW_RESOLUTION = 1600;
