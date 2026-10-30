import { fitPalmMotion, type ScreenPoint } from './ring-tracking.ts';

export type FlowMat = {
  rows: number; cols: number;
  data: Uint8Array; data32F: Float32Array;
  delete(): void;
};
export type FlowCv = {
  Mat: new () => FlowMat;
  Size: new (x: number, y: number) => unknown;
  matFromArray(rows: number, cols: number, type: number, data: ArrayLike<number>): FlowMat;
  matFromImageData(data: { width: number; height: number; data: Uint8ClampedArray }): FlowMat;
  cvtColor(source: FlowMat, destination: FlowMat, code: number): void;
  goodFeaturesToTrack(image: FlowMat, corners: FlowMat, count: number, quality: number, distance: number, mask: FlowMat): void;
  calcOpticalFlowPyrLK(previous: FlowMat, current: FlowMat, points: FlowMat, next: FlowMat, status: FlowMat, error: FlowMat, window: unknown, level: number): void;
  COLOR_RGBA2GRAY: number; CV_8UC1: number; CV_32FC2: number;
};
export type SkinMotion = { before: ScreenPoint[]; after: ScreenPoint[]; referenceAgeMs?: number };
export const SKIN_MOTION_FRAME_GAP_MS = 1200;

// A feature center inside the finger is insufficient: its full sampling
// window must stay on skin, including when the finger lies diagonally.
export function fingerTextureRegion(imageWidth: number, imageHeight: number, region: ScreenPoint[], fingerWidth: number | undefined, support: number) {
  if (region.length < 2) return null;
  const base = { x: region[0].x * imageWidth, y: region[0].y * imageHeight };
  const tip = { x: region[1].x * imageWidth, y: region[1].y * imageHeight };
  const dx = tip.x - base.x, dy = tip.y - base.y, length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 8) return null;
  // Foreshortening reduces projected bone length, not the known diameter.
  // Full-window margins below still keep every feature inside that skin strip.
  const halfWidth = fingerWidth !== undefined ? fingerWidth * 0.5 : length * 0.2;
  const margin = support * (Math.abs(dx) + Math.abs(dy)) / length;
  const radius = halfWidth - margin;
  if (!Number.isFinite(radius) || radius < 1) return null;
  const contains = (p: ScreenPoint) => {
    const along = ((p.x - base.x) * dx + (p.y - base.y) * dy) / length;
    const across = Math.abs((p.x - base.x) * dy - (p.y - base.y) * dx) / length;
    return p.x >= support && p.y >= support && p.x < imageWidth - support && p.y < imageHeight - support &&
      along >= length * 0.12 + margin && along <= length * 0.95 - margin && across <= radius;
  };
  return { base, tip, dx, dy, length, radius, halfWidth, contains };
}

type SkinPair = { before: ScreenPoint; after: ScreenPoint };

// Reject inconsistent features using a rigid similarity, not a broad
// displacement median that admits unrelated patches along a long finger.
// Rotation and camera-distance changes remain valid coherent skin motion.
export function fitSkinMotion(pairs: SkinPair[], maxResidual: number) {
  if (pairs.length < 6) return null;
  let best: SkinPair[] = [], bestError = Infinity;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const p = pairs[i], q = pairs[j];
    const dx = q.before.x - p.before.x, dy = q.before.y - p.before.y;
    const ex = q.after.x - p.after.x, ey = q.after.y - p.after.y;
    const denominator = dx * dx + dy * dy;
    if (denominator < 36) continue;
    const a = (dx * ex + dy * ey) / denominator, b = (dx * ey - dy * ex) / denominator;
    const scale = Math.hypot(a, b);
    if (scale < 0.8 || scale > 1.25) continue;
    const inliers: SkinPair[] = [];
    let error = 0;
    for (const pair of pairs) {
      const x = pair.before.x - p.before.x, y = pair.before.y - p.before.y;
      const distance = Math.hypot(p.after.x + a * x - b * y - pair.after.x,
        p.after.y + b * x + a * y - pair.after.y);
      if (distance <= 1.25) { inliers.push(pair); error += distance * distance; }
    }
    if (inliers.length > best.length || (inliers.length === best.length && error < bestError)) {
      best = inliers; bestError = error;
    }
  }
  if (best.length < 6 || best.length < pairs.length * 0.65) return null;
  const fit = fitPalmMotion(best.map(p => p.before), best.map(p => p.after));
  return fit && fit.residual <= maxResidual && fit.scale >= 0.8 && fit.scale <= 1.25 ? { fit, inliers: best } : null;
}

// Tracks actual skin texture between adjacent video frames. Landmarks still
// supply anatomy; optical flow carries the attachment during motion so noisy
// landmark positions do not directly shake the ring every frame.
export class SkinMotionTracker {
  private previous: FlowMat | null = null;
  private region: ScreenPoint[] = [];
  private time = 0;
  private fingerWidth: number | undefined;
  reset() { this.previous?.delete(); this.previous = null; this.region = []; this.time = 0; this.fingerWidth = undefined; }
  update(cv: FlowCv, image: { width: number; height: number; data: Uint8ClampedArray }, region: ScreenPoint[], time: number, fingerWidth?: number): SkinMotion | null {
    const source = cv.matFromImageData(image);
    const gray = new cv.Mat();
    try { cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY); }
    catch (error) { gray.delete(); throw error; }
    finally { source.delete(); }
    const temporary: FlowMat[] = [];
    const own = (mat: FlowMat) => { temporary.push(mat); return mat; };
    try {
      if (!this.previous || this.previous.cols !== image.width || this.previous.rows !== image.height || time <= this.time || time - this.time > SKIN_MOTION_FRAME_GAP_MS || this.region.length < 2 || region.length < 2) return null;
      const finger = fingerTextureRegion(image.width, image.height, this.region, this.fingerWidth, 7);
      const nextFinger = fingerTextureRegion(image.width, image.height, region, fingerWidth, 7);
      if (!finger || !nextFinger) return null;
      // Coarse LK levels enlarge the window and can see background even
      // though the finest-level patch is inside a narrow finger.
      const windowRoom = (value: NonNullable<ReturnType<typeof fingerTextureRegion>>) =>
        Math.min(value.halfWidth, value.length * 0.4) * value.length / (Math.abs(value.dx) + Math.abs(value.dy));
      const level = Math.max(0, Math.min(2, Math.floor(Math.log2(Math.min(windowRoom(finger), windowRoom(nextFinger)) / 10))));
      const support = 7 * 2 ** level + 2 * (2 ** level - 1);
      const previousSkin = fingerTextureRegion(image.width, image.height, this.region, this.fingerWidth, support);
      const currentSkin = fingerTextureRegion(image.width, image.height, region, fingerWidth, support);
      if (!previousSkin || !currentSkin) return null;
      const pixels = new Uint8Array(image.width * image.height);
      const { base, dx, dy, length, radius } = previousSkin;
      const bx = base.x, by = base.y;
      // Restrict feature selection to the ring finger, clear of background
      // edges and neighboring fingers. The region is from the previous frame.
      for (let y = Math.max(0, Math.floor(Math.min(by, by + dy) - radius)); y < Math.min(image.height, Math.ceil(Math.max(by, by + dy) + radius)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(bx, bx + dx) - radius)); x < Math.min(image.width, Math.ceil(Math.max(bx, bx + dx) + radius)); x++) {
          if (previousSkin.contains({ x, y })) pixels[y * image.width + x] = 255;
        }
      }
      const mask = own(cv.matFromArray(image.height, image.width, cv.CV_8UC1, pixels));
      const points = own(new cv.Mat());
      cv.goodFeaturesToTrack(this.previous, points, 32, 0.015, 3, mask);
      if (points.rows < 6) return null;
      const next = own(new cv.Mat()), status = own(new cv.Mat()), error = own(new cv.Mat());
      const window = new cv.Size(15, 15);
      cv.calcOpticalFlowPyrLK(this.previous, gray, points, next, status, error, window, level);
      const back = own(new cv.Mat()), backStatus = own(new cv.Mat()), backError = own(new cv.Mat());
      cv.calcOpticalFlowPyrLK(gray, this.previous, next, back, backStatus, backError, window, level);
      const pairs: { before: ScreenPoint; after: ScreenPoint }[] = [];
      for (let i = 0; i < points.rows; i++) {
        const p = { x: points.data32F[2 * i], y: points.data32F[2 * i + 1] };
        const q = { x: next.data32F[2 * i], y: next.data32F[2 * i + 1] };
        if (!status.data[i] || !backStatus.data[i] || error.data32F[i] > 22 || !Number.isFinite(q.x + q.y)) continue;
        if (Math.hypot(back.data32F[2 * i] - p.x, back.data32F[2 * i + 1] - p.y) > 0.65) continue;
        if (!previousSkin.contains(p) || !currentSkin.contains(q)) continue;
        pairs.push({ before: p, after: q });
      }
      const trackedMotion = fitSkinMotion(pairs, 0.7);
      if (!trackedMotion) return null;
      const { fit, inliers } = trackedMotion;
      // Compare displacement with current finger landmarks to reject a
      // background patch that accidentally entered the previous feature mask.
      const center = { x: bx + dx * 0.53, y: by + dy * 0.53 };
      const tracked = fit.map(center);
      const expected = { x: (region[0].x * 0.47 + region[1].x * 0.53) * image.width, y: (region[0].y * 0.47 + region[1].y * 0.53) * image.height };
      if (Math.hypot(tracked.x - expected.x, tracked.y - expected.y) > Math.max(4, length * 0.2)) return null;
      const normalize = (p: ScreenPoint) => ({ x: p.x / image.width, y: p.y / image.height });
      return { before: inliers.map(p => normalize(p.before)), after: inliers.map(p => normalize(p.after)) };
    } finally {
      for (const mat of temporary) mat.delete();
      this.previous?.delete(); this.previous = gray; this.region = region.map(p => ({ ...p })); this.time = time;
      this.fingerWidth = fingerWidth;
    }
  }
}
