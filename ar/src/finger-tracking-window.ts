import type { ScreenPoint } from './ring-tracking.ts';
import type { SkinMotion } from './skin-motion.ts';

export type FingerWindow = { x: number; y: number; size: number; imageWidth: number; imageHeight: number };
export const FINGER_TRACKING_RESOLUTION = 256;

/** Keep full camera detail around the proximal finger, instead of shrinking
 * the entire hand to 320px and leaving only a few pixels of usable skin. */
export class FingerTrackingWindow {
  private previous: FingerWindow | null = null;
  get diagnostics() { return this.previous ? { ...this.previous, resolution: FINGER_TRACKING_RESOLUTION } : null; }
  reset() { this.previous = null; }
  update(imageWidth: number, imageHeight: number, region: ScreenPoint[], fingerWidth?: number) {
    const [base, tip] = region;
    if (!base || !tip || !(imageWidth > 0 && imageHeight > 0)
      || ![base.x, base.y, tip.x, tip.y].every(Number.isFinite)) { this.reset(); return null; }
    const bx = base.x * imageWidth, by = base.y * imageHeight;
    const tx = tip.x * imageWidth, ty = tip.y * imageHeight;
    const length = Math.hypot(tx - bx, ty - by);
    if (length < 8) { this.reset(); return null; }
    const diameter = fingerWidth && Number.isFinite(fingerWidth) && fingerWidth > 0 ? fingerWidth : length * .4;
    const size = Math.max(1, Math.min(Math.min(imageWidth, imageHeight), Math.ceil(Math.max(48, length * 1.6, diameter * 3.4))));
    const previous = this.previous;
    const sameSource = previous?.imageWidth === imageWidth && previous.imageHeight === imageHeight;
    // A fixed window around a still finger preserves the stillness reference.
    // Reframe before skin reaches its edge, without chasing joint noise.
    const margin = previous ? Math.max(diameter * .65, previous.size * .15) : 0;
    const contained = sameSource && previous && [base, tip].every(p =>
      p.x * imageWidth >= previous.x + margin && p.x * imageWidth <= previous.x + previous.size - margin
      && p.y * imageHeight >= previous.y + margin && p.y * imageHeight <= previous.y + previous.size - margin);
    const reuse = contained && size >= previous.size * .6 && size <= previous.size * 1.45;
    const window: FingerWindow = reuse ? previous : {
      x: Math.max(0, Math.min(imageWidth - size, Math.round((bx + tx) * .5 - size * .5))),
      y: Math.max(0, Math.min(imageHeight - size, Math.round((by + ty) * .5 - size * .5))),
      size, imageWidth, imageHeight,
    };
    this.previous = window;
    return {
      window, previous: sameSource ? previous : null, changed: window !== previous,
      region: region.map(p => ({ x: (p.x * imageWidth - window.x) / window.size, y: (p.y * imageHeight - window.y) / window.size })),
      fingerWidth: diameter / window.size * FINGER_TRACKING_RESOLUTION,
    };
  }
}

/** Flow reports adjacent-frame image coordinates. Each frame can have a
 * different crop; convert both ends separately before transporting the ring. */
export function fingerMotionToVideo(motion: SkinMotion | null, previous: FingerWindow | null, current: FingerWindow): SkinMotion | null {
  if (!motion || !previous) return null;
  const point = (p: ScreenPoint, window: FingerWindow) => ({
    x: (window.x + p.x * window.size) / window.imageWidth,
    y: (window.y + p.y * window.size) / window.imageHeight,
  });
  return { ...motion, before: motion.before.map(p => point(p, previous)), after: motion.after.map(p => point(p, current)) };
}
