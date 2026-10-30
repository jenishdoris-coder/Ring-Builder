type Point = { x: number; y: number };
type Frame = { width: number; height: number; data: Uint8ClampedArray };
const evidence = (status: string) => ({ status, gain: null as number | null, offset: null as number | null,
  rms: null as number | null, motion: null as number | null, tileMotion: null as number | null,
  magnification: null as number | null, magnificationExplained: null as number | null,
  textureVariance: null as number | null, referenceAgeMs: 0, poseStable: false });

function imageMagnification(points: Point[], gradients: Point[], values: number[], residuals: number[], gain: number) {
  const n = points.length;
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / n, y: sum.y + p.y / n }), { x: 0, y: 0 });
  const mean = values.reduce((sum, v) => sum + v / n, 0);
  const brightness = values.map(v => v - mean);
  const brightnessEnergy = brightness.reduce((sum, v) => sum + v * v, 0);
  const extent = Math.sqrt(points.reduce((sum, p) => sum + (p.x - center.x) ** 2 + (p.y - center.y) ** 2, 0) / n);
  if (!(extent > 2 && brightnessEnergy > 0)) return null;
  const columns = [0, 1, 2].map(axis => {
    const column = gradients.map((g, i) => gain * (axis === 0 ? g.x : axis === 1 ? g.y
      : (g.x * (points[i].x - center.x) + g.y * (points[i].y - center.y)) / extent));
    const average = column.reduce((sum, v) => sum + v / n, 0);
    const correlation = column.reduce((sum, v, i) => sum + (v - average) * brightness[i], 0) / brightnessEnergy;
    // Exposure gain/offset was removed from the residuals. Remove it from the
    // motion basis too, so brightness adjustment cannot look like camera zoom.
    return column.map((v, i) => v - average - correlation * brightness[i]);
  });
  const matrix = columns.map(a => [...columns.map(b => a.reduce((sum, v, i) => sum + v * b[i], 0)),
    a.reduce((sum, v, i) => sum + v * residuals[i], 0)]);
  const ridge = Math.max(0.0001, (matrix[0][0] + matrix[1][1] + matrix[2][2]) * 0.001);
  for (let i = 0; i < 3; i++) matrix[i][i] += ridge;
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const divisor = matrix[i][i];
    if (Math.abs(divisor) < 1e-8) return null;
    for (let j = i; j < 4; j++) matrix[i][j] /= divisor;
    for (let row = 0; row < 3; row++) if (row !== i) {
      const factor = matrix[row][i];
      for (let j = i; j < 4; j++) matrix[row][j] -= factor * matrix[i][j];
    }
  }
  const coefficients = matrix.map(row => row[3]);
  const energy = residuals.reduce((sum, r) => sum + r * r, 0);
  const remaining = residuals.reduce((sum, r, i) => sum
    + (r - columns.reduce((value, col, j) => value + col[i] * coefficients[j], 0)) ** 2, 0);
  return { scale: -coefficients[2] / extent, explained: energy > 1e-8 ? 1 - remaining / energy : 0 };
}

// Compare a fixed image of the proximal finger. Once fitted, keep every
// sampling neighborhood inside skin so the background cannot own stillness.
// Landmark shape and inferred depth cannot establish that an image moved.
export class FingerStillnessTracker {
  private reference: { points: Point[]; tiles: number[]; gradients: Point[]; region: Point[]; values: number[]; mean: number; variance: number; time: number; width: number; height: number; fingerWidth?: number } | null = null;
  private frames = 0;
  private poseFrames = 0;
  private measurement = evidence('waiting');
  get diagnostics() { return { ...this.measurement, confirmationFrames: this.frames }; }
  reset() { this.reference = null; this.frames = 0; this.poseFrames = 0; this.measurement = evidence('waiting'); }

  update(image: Frame, region: Point[], time: number, fingerWidth?: number) {
    if (region.length < 2) { this.reset(); return false; }
    const fittedWidth = fingerWidth && Number.isFinite(fingerWidth) && fingerWidth > 0 ? fingerWidth : undefined;
    // A 5x5 average plus gradient samples cannot fit inside a narrower finger.
    if (fittedWidth && fittedWidth <= 8) { this.reset(); return false; }
    const sample = (points: Point[]) => points.map(p => {
      let value = 0;
      // Smooth sensor/compression noise before comparing geometry. Sampling
      // single noisy details repeatedly prevented the stationary pose lock.
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        const i = ((p.y + y) * image.width + p.x + x) * 4;
        value += (image.data[i] * 77 + image.data[i + 1] * 150 + image.data[i + 2] * 29) / 256;
      }
      return value / 25;
    });
    const seed = (reason = 'warming') => {
      this.measurement = evidence(reason);
      const [base, tip] = region;
      const bx = base.x * image.width, by = base.y * image.height;
      const dx = (tip.x - base.x) * image.width, dy = (tip.y - base.y) * image.height;
      const length = Math.hypot(dx, dy);
      if (length < 12) { this.reset(); return false; }
      const radius = fittedWidth ? Math.min(length * 0.4, fittedWidth / 2 - 4) : length * 0.4;
      const points: Point[] = [];
      const tiles: number[] = [];
      for (let a = 0; a < 20; a++) for (let b = 0; b < 12; b++) {
        const along = fittedWidth ? 0.1 + a / 19 * 0.8 : -0.05 + a / 19 * 1.1;
        const across = (b / 11 - 0.5) * 2 * radius / length;
        const x = Math.round(bx + dx * along - dy * across), y = Math.round(by + dy * along + dx * across);
        if (x >= 3 && y >= 3 && x < image.width - 3 && y < image.height - 3) {
          points.push({ x, y });
          tiles.push(Math.min(2, Math.floor(a * 3 / 20)) * 2 + Math.floor(b / 6));
        }
      }
      if (points.length < 180) { this.reset(); return false; }
      const values = sample(points), mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      // Blank/featureless images cannot prove that a hand is stationary.
      if (!Number.isFinite(variance) || variance < 36) { this.reset(); this.measurement.status = 'insufficient texture'; return false; }
      // A smooth lighting ramp has contrast but supplies no independent skin
      // texture: translating it looks exactly like an exposure offset. Reject
      // that ambiguity before compensating illumination over a wider range.
      const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 });
      let xx = 0, xy = 0, yy = 0, vx = 0, vy = 0;
      for (let i = 0; i < points.length; i++) {
        const x = points[i].x - center.x, y = points[i].y - center.y, value = values[i] - mean;
        xx += x * x; xy += x * y; yy += y * y; vx += x * value; vy += y * value;
      }
      const determinant = xx * yy - xy * xy;
      if (!(determinant > 0)) { this.reset(); return false; }
      const ax = (yy * vx - xy * vy) / determinant, ay = (xx * vy - xy * vx) / determinant;
      const textureVariance = variance - (ax * vx + ay * vy) / points.length;
      if (textureVariance < Math.max(4, variance * 0.02)) { this.reset(); this.measurement.status = 'lighting gradient'; return false; }
      this.measurement.textureVariance = textureVariance;
      const left = sample(points.map(p => ({ x: p.x - 1, y: p.y })));
      const right = sample(points.map(p => ({ x: p.x + 1, y: p.y })));
      const top = sample(points.map(p => ({ x: p.x, y: p.y - 1 })));
      const bottom = sample(points.map(p => ({ x: p.x, y: p.y + 1 })));
      const gradients = points.map((_, i) => ({ x: (right[i] - left[i]) / 2, y: (bottom[i] - top[i]) / 2 }));
      this.reference = { points, tiles, gradients, region: region.map(p => ({ ...p })), values, mean, variance, time, width: image.width, height: image.height, fingerWidth: fittedWidth };
      this.frames = 0;
      this.poseFrames = 0;
      return false;
    };
    const ref = this.reference;
    if (!ref || ref.width !== image.width || ref.height !== image.height || time - ref.time < 0) return seed();
    if (!!fittedWidth !== !!ref.fingerWidth || fittedWidth && ref.fingerWidth && Math.abs(fittedWidth / ref.fingerWidth - 1) > 0.2) return seed('width changed');
    const length = Math.hypot((ref.region[1].x - ref.region[0].x) * image.width, (ref.region[1].y - ref.region[0].y) * image.height);
    const displacement = Math.hypot(
      (region[0].x + region[1].x - ref.region[0].x - ref.region[1].x) * image.width / 2,
      (region[0].y + region[1].y - ref.region[0].y - ref.region[1].y) * image.height / 2);
    if (displacement > Math.max(8, length * 0.35)) return seed('region changed');
    const values = sample(ref.points), mean = values.reduce((a, b) => a + b, 0) / values.length;
    const covariance = values.reduce((sum, v, i) => sum + (v - mean) * (ref.values[i] - ref.mean), 0) / values.length;
    // Compensate exposure without altering pixel geometry. Clamping gain to
    // +/-15% made auto-exposure appear as motion and repeatedly reseed the lock.
    // Large changes/clipping still fail the residual and motion quality gates.
    const gain = covariance / ref.variance;
    const offset = mean - gain * ref.mean;
    if (!Number.isFinite(gain) || gain < 0.65 || gain > 1.55 || Math.abs(offset) > 60) return seed('exposure changed');
    const residuals = values.map((v, i) => v - mean - gain * (ref.values[i] - ref.mean));
    const error = Math.sqrt(residuals.reduce((sum, v) => sum + v * v, 0) / values.length);
    // A looser noise limit alone could hide slow movement. Fit residuals to
    // the fixed reference's image gradients: translation/bending is coherent,
    // whereas sensor noise is not. Local tiles stop opposite motions cancelling.
    const motion = (tile: number | null) => {
      let xx = 0, xy = 0, yy = 0, sx = 0, sy = 0;
      for (let i = 0; i < values.length; i++) {
        if (tile !== null && ref.tiles[i] !== tile) continue;
        const gx = ref.gradients[i].x * gain, gy = ref.gradients[i].y * gain;
        xx += gx * gx; xy += gx * gy; yy += gy * gy;
        sx += gx * residuals[i]; sy += gy * residuals[i];
      }
      // Regularize uniform edges, which can only observe motion across them.
      const ridge = Math.max(0.001, (xx + yy) * 0.01);
      xx += ridge; yy += ridge;
      const determinant = xx * yy - xy * xy;
      return Math.hypot((yy * sx - xy * sy) / determinant, (xx * sy - xy * sx) / determinant);
    };
    const noiseLimit = Math.max(2, Math.min(2.5, Math.sqrt(ref.variance) * 0.1));
    const globalMotion = motion(null), tileMotion = Math.max(...[0, 1, 2, 3, 4, 5].map(tile => motion(tile)));
    // Zoom around the attachment has little mean translation. On a short
    // finger even each tile can move less than the noise limit while diameter
    // changes materially. Fit expansion over the whole fixed pixel reference.
    const magnification = imageMagnification(ref.points, ref.gradients, ref.values, residuals, gain);
    const scaleChanged = magnification !== null && magnification.explained > 0.5 && Math.abs(magnification.scale) > 0.008;
    // Tiny tremor or subpixel camera resampling does not validate a new 3D
    // surface normal. Keep a separate, bounded fixed-image depth reference;
    // screen position may continue following texture. Never rebase it for
    // each small step, which would conceal a slow real movement or zoom.
    if (!Number.isFinite(error + globalMotion + tileMotion) || error > noiseLimit
      || globalMotion > 0.8 || tileMotion > 1.15 || scaleChanged) {
      const changed = { gain, offset, rms: error, motion: globalMotion, tileMotion,
        magnification: magnification?.scale ?? null, magnificationExplained: magnification?.explained ?? null };
      seed('image changed');
      Object.assign(this.measurement, changed);
      return false;
    }
    this.poseFrames++;
    this.frames = globalMotion <= 0.22 && tileMotion <= 0.45 ? this.frames + 1 : 0;
    // Keep the same reference while stationary so slow motion cannot be lost
    // as a succession of individually tiny frame-to-frame changes.
    const locked = this.frames >= 3 && time - ref.time >= 300;
    const poseStable = this.poseFrames >= 4 && time - ref.time >= 350;
    this.measurement = { ...this.measurement, status: locked ? 'locked' : poseStable ? 'depth stable' : 'warming',
      gain, offset, rms: error, motion: globalMotion, tileMotion,
      magnification: magnification?.scale ?? null, magnificationExplained: magnification?.explained ?? null,
      referenceAgeMs: time - ref.time, poseStable };
    return locked;
  }
}
