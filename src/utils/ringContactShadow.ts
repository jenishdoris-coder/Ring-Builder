import { Vector3 } from "webgi";
import { isDiamondMesh } from "./meshUtils";

const WIDTH = 256, HEIGHT = 128;
const cachedProfiles = new WeakMap<object, RingContactShadow>();
export type RingContactShadow = { data: Uint8Array<ArrayBuffer>; width: number; height: number; minY: number; spanY: number };

/** Project the real metal onto a cylindrical skin receiver. Unlike a band-wide
 * strip this preserves bypass curves, split shoulders and gaps between rows.
 * Only CPU work is needed, once per loaded shank; both portraits reuse it. */
export const getRingContactShadow = (shank: any, radius: number): RingContactShadow => {
  const cached = cachedProfiles.get(shank);
  if (cached) return cached;
  shank.updateWorldMatrix(true, true);
  const inverse = shank.matrixWorld.clone().invert();
  const meshes: { positions: Float32Array; index: any; start: number; end: number }[] = [];
  const point = new Vector3();
  let minY = Infinity, maxY = -Infinity;
  shank.traverseVisible((mesh: any) => {
    const attribute = mesh.isMesh && !isDiamondMesh(mesh) && mesh.geometry?.attributes?.position;
    if (!attribute) return;
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    const positions = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i).applyMatrix4(transform);
      positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const index = mesh.geometry.index, count = index?.count ?? attribute.count;
    const start = mesh.geometry.drawRange?.start ?? 0;
    meshes.push({ positions, index, start, end: Math.min(count, start + (mesh.geometry.drawRange?.count ?? count)) });
  });
  const margin = radius * .4;
  if (!Number.isFinite(minY)) minY = maxY = 0;
  minY -= margin; maxY += margin;
  const spanY = Math.max(radius, maxY - minY), coverage = new Float32Array(WIDTH * HEIGHT);
  const vertices = Array.from({ length: 3 }, () => ({ x: 0, y: 0, radius: 0 }));
  for (const mesh of meshes) for (let i = mesh.start; i + 2 < mesh.end; i += 3) {
    for (let j = 0; j < 3; j++) {
      const offset = (mesh.index ? mesh.index.getX(i + j) : i + j) * 3;
      const x = mesh.positions[offset], y = mesh.positions[offset + 1], z = mesh.positions[offset + 2];
      vertices[j].x = (Math.atan2(x, z) / (2 * Math.PI) + .5) * WIDTH;
      vertices[j].y = (y - minY) / spanY * HEIGHT;
      vertices[j].radius = Math.hypot(x, z);
    }
    // Unwrap triangles crossing the rear seam instead of filling the atlas.
    const [a, b, c] = vertices;
    if (Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x) > WIDTH / 2) {
      vertices.forEach(v => { if (v.x > WIDTH / 2) v.x -= WIDTH; });
    }
    const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(area) < .00001) continue;
    const left = Math.floor(Math.min(a.x, b.x, c.x)), right = Math.ceil(Math.max(a.x, b.x, c.x));
    const bottom = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), top = Math.min(HEIGHT - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
      const wa = ((b.y - c.y) * (x + .5 - c.x) + (c.x - b.x) * (y + .5 - c.y)) / area;
      const wb = ((c.y - a.y) * (x + .5 - c.x) + (a.x - c.x) * (y + .5 - c.y)) / area;
      const wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -.0001) continue;
      const gap = Math.max(0, wa * a.radius + wb * b.radius + wc * c.radius - radius);
      const contact = Math.exp(-gap / (radius * .09));
      const pixel = y * WIDTH + (x % WIDTH + WIDTH) % WIDTH;
      coverage[pixel] = Math.max(coverage[pixel], contact);
    }
  }
  // Blur in physical units, with angular wrapping and no axial wrapping. Two
  // channels give a tight contact plus a softer penumbra without filling gaps.
  const blur = (distance: number) => {
    let values = coverage;
    for (const horizontal of [true, false]) {
      const sigma = Math.max(.5, distance / (horizontal ? radius * 2 * Math.PI / WIDTH : spanY / HEIGHT));
      const range = Math.ceil(sigma * 3), weights = Array.from({ length: range * 2 + 1 }, (_, i) => Math.exp(-.5 * ((i - range) / sigma) ** 2));
      const total = weights.reduce((sum, value) => sum + value, 0), result = new Float32Array(coverage.length);
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        let sum = 0;
        for (let offset = -range; offset <= range; offset++) {
          const sx = horizontal ? (x + offset + WIDTH) % WIDTH : x, sy = horizontal ? y : y + offset;
          if (sy >= 0 && sy < HEIGHT) sum += values[sy * WIDTH + sx] * weights[offset + range];
        }
        result[y * WIDTH + x] = sum / total;
      }
      values = result;
    }
    return values;
  };
  const tight = blur(radius * .025), soft = blur(radius * .075), data = new Uint8Array(coverage.length * 4);
  for (let i = 0; i < coverage.length; i++) {
    data[i * 4] = Math.round(tight[i] * 255); data[i * 4 + 1] = Math.round(soft[i] * 255); data[i * 4 + 3] = 255;
  }
  const profile = { data, width: WIDTH, height: HEIGHT, minY, spanY };
  cachedProfiles.set(shank, profile);
  return profile;
};
