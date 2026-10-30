import warmPortrait from "../assets/lifestyle/warm-closeup.png";
import fairPortrait from "../assets/lifestyle/fair-closeup.png";

/** Finger seats are measured against the original, ring-free photographs. */
export const LIFESTYLE_PHOTOS = [
  { id: "lifestyle-warm-v7", label: "Warm portrait", image: warmPortrait, center: [.530, .651], fingerWidth: .147, angle: 39, tilt: -12 },
  { id: "lifestyle-fair-v7", label: "Fair portrait", image: fairPortrait, center: [.751, .643], fingerWidth: .128, angle: -9, tilt: -9 },
] as const;
export const isLifestyleView = (id: string) => LIFESTYLE_PHOTOS.some(photo => photo.id === id);
