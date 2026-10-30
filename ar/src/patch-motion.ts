import { fitPalmMotion, type ScreenPoint } from './ring-tracking.ts';
import { fingerTextureRegion, fitSkinMotion, SKIN_MOTION_FRAME_GAP_MS, type SkinMotion } from './skin-motion.ts';
import { isIPadDevice } from './ring-runtime.ts';

type GrayFrame = { width: number; height: number; data: Uint8Array };
type ImageFrame = { width: number; height: number; data: Uint8ClampedArray };

export function usesLightweightTracking(userAgent: string, touchPoints: number) {
  // Keep mobile WebKit below the combined vision/graphics memory peak.
  // This changes skin-motion processing, never camera or ring resolution.
  return isIPadDevice(userAgent, touchPoints) || (/iPhone|iPod/.test(userAgent) && touchPoints > 0);
}

function gray(image: ImageFrame): GrayFrame {
  const data = new Uint8Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) {
    const j = i * 4;
    data[i] = (image.data[j] * 77 + image.data[j + 1] * 150 + image.data[j + 2] * 29) >> 8;
  }
  return { width: image.width, height: image.height, data };
}

function inside(frame: GrayFrame, x: number, y: number) {
  return x >= 4 && y >= 4 && x < frame.width - 4 && y < frame.height - 4;
}

// Prefer a nearby crease/corner over an arbitrary patch of smooth skin.
// Two-dimensional gradient support avoids tracking along a featureless edge.
function featurePoint(frame: GrayFrame, seed: ScreenPoint, allowed: (p: ScreenPoint) => boolean) {
  let best = seed, bestScore = 0;
  for (const oy of [-3, 0, 3]) for (const ox of [-3, 0, 3]) {
    const x = seed.x + ox, y = seed.y + oy;
    if (!inside(frame, x, y) || !allowed({ x, y })) continue;
    let xx = 0, xy = 0, yy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = (y + dy) * frame.width + x + dx;
      const gx = frame.data[i + 1] - frame.data[i - 1];
      const gy = frame.data[i + frame.width] - frame.data[i - frame.width];
      xx += gx * gx; xy += gx * gy; yy += gy * gy;
    }
    const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 50;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

// Compare normalized 7x7 patches, tolerating exposure gain and offset. Search is
// bounded regardless of screen size or distance travelled by the hand.
function match(a: GrayFrame, b: GrayFrame, p: ScreenPoint, expected: ScreenPoint, allowed: (point: ScreenPoint) => boolean) {
  let best = Infinity, bestX = 0, bestY = 0;
  const patch: number[] = [];
  let sum = 0, square = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const value = a.data[(p.y + dy) * a.width + p.x + dx];
    patch.push(value); sum += value; square += value * value;
  }
  const variance = square / 49 - (sum / 49) ** 2;
  if (variance < 4) return null;
  const mean = sum / 49;
  for (let i = 0; i < patch.length; i++) patch[i] -= mean;
  const score = (x: number, y: number) => {
    if (!inside(b, x, y) || !allowed({ x, y })) return Infinity;
    let currentSum = 0, currentSquare = 0, cross = 0, index = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const value = b.data[(y + dy) * b.width + x + dx];
      currentSum += value; currentSquare += value * value;
      cross += patch[index++] * value;
    }
    const currentVariance = currentSquare / 49 - (currentSum / 49) ** 2;
    if (currentVariance < 4) return Infinity;
    const correlation = cross / (49 * Math.sqrt(variance * currentVariance));
    // Keep the original intensity-squared score units for the noise and
    // ambiguity gates. Changing brightness cannot shift a true texture match.
    return Math.max(0, 2 * variance * (1 - Math.min(1, correlation)));
  };
  const cx = Math.round(expected.x), cy = Math.round(expected.y);
  // Full integer search avoids missing a textured patch on a coarse grid.
  for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
    const error = score(x, y);
    if (error < best) { best = error; bestX = x; bestY = y; }
  }
  if (best > Math.min(180, variance * 0.8)) return null;
  // Weak texture may match many positions equally well. Do not mistake that
  // ambiguity for a precise, motionless skin attachment.
  let alternative = Infinity;
  for (let y = cy - 7; y <= cy + 7; y += 2) for (let x = cx - 7; x <= cx + 7; x += 2) {
    if (Math.hypot(x - bestX, y - bestY) > 2) alternative = Math.min(alternative, score(x, y));
  }
  if (alternative < best * 1.2 + 0.5) return null;
  // Parabolic refinement gives sub-pixel motion rather than 1px steps.
  const refine = (minus: number, plus: number) => {
    const denominator = minus + plus - 2 * best;
    return Number.isFinite(denominator) && denominator > 0.01
      ? Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * denominator))) : 0;
  };
  return {
    x: bestX + refine(score(bestX - 1, bestY), score(bestX + 1, bestY)),
    y: bestY + refine(score(bestX, bestY - 1), score(bestX, bestY + 1)),
  };
}

// Small-frame sparse texture tracking without a second WebAssembly runtime.
// Anatomy remains supplied by MediaPipe; uncertain texture falls back to it.
export class PatchMotionTracker {
  private previous: GrayFrame | null = null;
  private region: ScreenPoint[] = [];
  private time = 0;
  private referenceTime = 0;
  private mapping: ReturnType<typeof fitPalmMotion> = null;
  private lastFrame: GrayFrame | null = null;
  private lastRegion: ScreenPoint[] = [];
  private referenceWidth: number | undefined;
  private lastWidth: number | undefined;
  reset() { this.previous = null; this.region = []; this.time = 0; this.referenceTime = 0; this.mapping = null; this.lastFrame = null; this.lastRegion = []; this.referenceWidth = undefined; this.lastWidth = undefined; }
  update(image: ImageFrame, region: ScreenPoint[], time: number, fingerWidth?: number): SkinMotion | null {
    const current = gray(image), previous = this.previous, oldRegion = this.region, oldTime = this.time;
    const lastFrame = this.lastFrame, lastRegion = this.lastRegion;
    const lastWidth = this.lastWidth;
    this.lastFrame = current; this.lastRegion = region.map(p => ({ ...p }));
    this.lastWidth = fingerWidth;
    this.time = time;
    const rebase = () => {
      this.previous = current; this.region = region.map(p => ({ ...p }));
      this.referenceTime = time; this.mapping = null;
      this.referenceWidth = fingerWidth;
      return null;
    };
    if (!previous || previous.width !== current.width || previous.height !== current.height ||
        time <= oldTime || time - oldTime > SKIN_MOTION_FRAME_GAP_MS || oldRegion.length < 2 || region.length < 2) return rebase();
    const track = (reference: GrayFrame, referenceRegion: ScreenPoint[], prediction: ReturnType<typeof fitPalmMotion>, width?: number) => {
      const previousSkin = fingerTextureRegion(image.width, image.height, referenceRegion, width, 3);
      const currentSkin = fingerTextureRegion(image.width, image.height, region, fingerWidth, 3);
      if (!previousSkin || !currentSkin || previousSkin.length < 12) return null;
      const { base, dx, dy, length, radius, contains: allowed } = previousSkin;
      const pairs: { before: ScreenPoint; after: ScreenPoint }[] = [];
      for (const along of [0.22, 0.38, 0.54, 0.70, 0.86]) for (const across of [-0.15, 0, 0.15]) {
        const offset = across === 0 ? 0 : Math.sign(across) * Math.min(length * 0.15, radius * 0.7);
        const p = featurePoint(reference, { x: Math.round(base.x + dx * along - dy / length * offset), y: Math.round(base.y + dy * along + dx / length * offset) }, allowed);
        if (!inside(reference, p.x, p.y) || !allowed(p)) continue;
        if (pairs.some(pair => Math.hypot(pair.before.x - p.x, pair.before.y - p.y) < 3)) continue;
        const u = ((p.x - base.x) * dx + (p.y - base.y) * dy) / (length * length);
        const v = ((p.y - base.y) * dx - (p.x - base.x) * dy) / (length * length);
        const expected = { x: currentSkin.base.x + currentSkin.dx * u - currentSkin.dy * v,
          y: currentSkin.base.y + currentSkin.dy * u + currentSkin.dx * v };
        const predicted = prediction?.map(p) ?? expected;
        let q = match(reference, current, p, predicted, currentSkin.contains);
        if (!q && Math.hypot(predicted.x - expected.x, predicted.y - expected.y) > 2) q = match(reference, current, p, expected, currentSkin.contains);
        if (!q && !prediction && Math.hypot(p.x - expected.x, p.y - expected.y) > 4) q = match(reference, current, p, p, currentSkin.contains);
        if (!q || !currentSkin.contains(q)) continue;
        const sourcePoint = { x: Math.round(q.x), y: Math.round(q.y) };
        if (!currentSkin.contains(sourcePoint)) continue;
        const back = match(current, reference, sourcePoint, p, allowed);
        if (!back || Math.hypot(back.x - p.x, back.y - p.y) > 0.8) continue;
        pairs.push({ before: p, after: q });
      }
      const trackedMotion = fitSkinMotion(pairs, 0.8);
      if (!trackedMotion) return null;
      const { fit, inliers } = trackedMotion;
      return { fit, inliers, length, center: { x: base.x + dx * 0.53, y: base.y + dy * 0.53 } };
    };
    let tracked = track(previous, oldRegion, this.mapping, this.referenceWidth);
    let recentFrame = false;
    if (!tracked && lastFrame && lastRegion.length >= 2 && lastFrame !== previous) {
      // A bent finger changes patch appearance. Retry against the preceding
      // video frame before dropping skin tracking and chasing landmarks.
      tracked = track(lastFrame, lastRegion, null, lastWidth);
      recentFrame = true;
    }
    if (!tracked) return rebase();
    const { fit, inliers, center, length } = tracked;
    const normalize = (p: ScreenPoint) => ({ x: p.x / image.width, y: p.y / image.height });
    // Keep a fixed skin image while the hand is near its reference pose.
    // Return *incremental* motion using the previous reference-to-frame fit;
    // directly returning reference displacement would overcount movement.
    const motion = {
      before: inliers.map(p => normalize(!recentFrame && this.mapping ? this.mapping.map(p.before) : p.before)),
      after: inliers.map(p => normalize(p.after)),
      referenceAgeMs: recentFrame ? time - oldTime : time - this.referenceTime,
    };
    this.mapping = fit;
    const moved = fit.map(center);
    if (recentFrame || Math.hypot(moved.x - center.x, moved.y - center.y) > length * 0.25
      || Math.abs(fit.angle) > 0.15 || Math.abs(fit.scale - 1) > 0.06 || time - this.referenceTime > 5000) rebase();
    return motion;
  }
}
