import { Vector3 } from 'three';
import type { HandPoint, RingPlacement, ScreenPoint } from './ring-tracking.ts';

export type HandOcclusionSnapshot = {
  landmarks: HandPoint[];
  screen: ScreenPoint[];
  width: number;
  height: number;
  mode: 'user' | 'environment';
  pose?: RingPlacement;
};

// Unchanged proximal-finger pixels establish the ring's stability, not the
// stability of every neighboring finger. Keep their masks quiet under small
// detector noise, but release each chain independently when it actually moves.
export function selectHandOcclusion(
  previous: HandOcclusionSnapshot | null,
  current: HandOcclusionSnapshot,
  imageStill: boolean,
  ring?: Pick<RingPlacement, 'width' | 'handScale' | 'imageDepthScale'> | null,
): HandOcclusionSnapshot {
  if (!imageStill || !previous || !ring || !(ring.width > 0)
    || previous.width !== current.width || previous.height !== current.height || previous.mode !== current.mode
    || previous.landmarks.length < 21 || current.landmarks.length < 21
    || previous.screen.length < 21 || current.screen.length < 21) return current;
  const screenThreshold = Math.max(6, Math.min(10, ring.width * 0.09));
  const depthThreshold = Math.max(8, Math.min(16, ring.width * 0.12));
  const depthScale = ring.imageDepthScale ?? ring.handScale / 0.05;
  const depth = (p: HandPoint) => ring.imageDepthScale ? p.z : p.worldZ;
  const landmarks = [...previous.landmarks], screen = [...previous.screen];
  for (const ids of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [17, 18, 19, 20]]) {
    const screenSteps = ids.map(i => Math.hypot(current.screen[i].x - previous.screen[i].x,
      current.screen[i].y - previous.screen[i].y));
    const depthSteps = ids.map(i => {
      const before = depth(previous.landmarks[i]), after = depth(current.landmarks[i]);
      return Number.isFinite(before) && Number.isFinite(after) ? Math.abs(after! - before!) * depthScale : 0;
    });
    const moved = screenSteps.filter(step => step > screenThreshold).length >= 2
      || screenSteps.some(step => step > screenThreshold * 2)
      || depthSteps.filter(step => step > depthThreshold).length >= 2
      || depthSteps.some(step => step > depthThreshold * 2);
    if (moved) for (const i of ids) { landmarks[i] = current.landmarks[i]; screen[i] = current.screen[i]; }
  }
  // The prior snapshot stays the reference until movement exceeds the noise
  // allowance, so successive small real steps cannot be averaged away.
  return { ...current, landmarks, screen, pose: previous.pose ?? current.pose };
}

export const PALM_MASK_VERTEX_COUNT = 18;

// A wrist point and four knuckle centers under-cover the actual palm. Build
// its two wrist edges and extend the knuckle boundary into the finger webs.
// The expansion is measured in finger diameters, not fixed screen pixels.
export function palmOcclusionTriangles(landmarks: HandPoint[], screen: ScreenPoint[], ring: RingPlacement) {
  const ids = [0, 5, 9, 13, 17];
  const depth = (i: number) => ring.imageDepthScale ? landmarks[i]?.z : landmarks[i]?.worldZ;
  if (![...ids, 14].every(i => landmarks[i] && screen[i] && Number.isFinite(depth(i)))) return [];
  const referenceDepth = depth(13)! * 0.47 + depth(14)! * 0.53;
  const pixelsPerMeter = ring.imageDepthScale ?? ring.handScale / 0.05;
  const point = (i: number) => new Vector3(screen[i].x, -screen[i].y,
    Math.max(-ring.width * 2, Math.min(ring.width * 2, (referenceDepth - depth(i)!) * pixelsPerMeter)) + ring.width * 0.42);
  const across = point(5).sub(point(17)); across.z = 0;
  const span = across.length();
  if (span < 1e-6) return [];
  across.divideScalar(span);
  const wristHalfWidth = Math.max(ring.width * .7, Math.min(ring.width * 1.6, span * .35));
  const knuckles = [5, 9, 13, 17].map(i => {
    const p = point(i);
    if (i === 5) p.addScaledVector(across, ring.width * .42);
    if (i === 17) p.addScaledVector(across, -ring.width * .42);
    if (screen[i + 1] && Number.isFinite(depth(i + 1))) {
      const direction = point(i + 1).sub(point(i));
      const distance = Math.hypot(direction.x, direction.y);
      if (distance > 1) p.addScaledVector(direction, Math.min(.35, ring.width * .28 / distance));
    }
    return p;
  });
  const outline = [point(0).addScaledVector(across, wristHalfWidth), ...knuckles, point(0).addScaledVector(across, -wristHalfWidth)];
  const center = outline.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / outline.length);
  return outline.flatMap((p, i) => [center.clone(), p, outline[(i + 1) % outline.length].clone()]);
}

export function handOcclusionSegments(landmarks: HandPoint[], screen: ScreenPoint[], ring: RingPlacement) {
  if (landmarks.length < 21 || screen.length < 21) return [];
  const depth = (i: number) => ring.imageDepthScale ? landmarks[i].z : landmarks[i].worldZ;
  if (![0, 13, 14].every(i => Number.isFinite(depth(i)))) return [];
  const referenceDepth = depth(13)! * 0.47 + depth(14)! * 0.53;
  const pixelsPerMeter = ring.imageDepthScale ?? ring.handScale / 0.05;
  const point = (i: number) => new Vector3(screen[i].x, -screen[i].y,
    Math.max(-ring.width * 2, Math.min(ring.width * 2, (referenceDepth - depth(i)!) * pixelsPerMeter)));
  const fingers = [
    { ids: [1, 2, 3, 4], width: 1.08 }, { ids: [5, 6, 7, 8], width: 1.02 },
    { ids: [9, 10, 11, 12], width: 1.07 }, { ids: [14, 15, 16], width: 0.9 },
    { ids: [17, 18, 19, 20], width: 0.82 },
  ];
  return fingers.flatMap(finger => finger.ids.slice(1).flatMap((id, segment) => {
    const base = finger.ids[segment];
    if (![base, id].every(i => Number.isFinite(depth(i)))) return [];
    const a = point(base), b = point(id);
    // Slight inset avoids cutting the ring outside the observed finger edge.
    const radius = ring.width * 0.47 * finger.width * (1 - segment * 0.10);
    return [{ a, b, radius, capEnd: segment < finger.ids.length - 2 }];
  }));
}

/** Rounded internal joints close the wedges left between bent cylinders.
 * Fingertips remain bounded by the observed tip instead of adding a sphere
 * beyond it that could erase jewelry in otherwise empty camera pixels. */
export function handOcclusionJoints(segments: ReturnType<typeof handOcclusionSegments>) {
  const joints: { position: Vector3; radius: number }[] = [];
  for (const segment of segments) for (const p of [segment.a, ...(segment.capEnd ? [segment.b] : [])]) {
    const radius = segment.radius * 1.04;
    const existing = joints.find(joint => joint.position.distanceToSquared(p) < 1e-8);
    if (existing) existing.radius = Math.max(existing.radius, radius);
    else joints.push({ position: p.clone(), radius });
  }
  return joints;
}

/** Filter each neighboring finger independently. A ring-finger stillness
 * lock must not freeze a slowly crossing finger until a 6–10px jump occurs. */
export class HandOcclusionStabilizer {
  private previous: HandOcclusionSnapshot | null = null;
  private raw: HandOcclusionSnapshot | null = null;
  private steps = new Map<number, Vector3>();
  private time = 0;
  reset() { this.previous = null; this.raw = null; this.steps.clear(); this.time = 0; }
  update(current: HandOcclusionSnapshot, stationary: boolean, ring: RingPlacement | null | undefined, time: number) {
    const previous = this.previous, raw = this.raw;
    if (!previous || !raw || !ring || !(ring.width > 0) || time <= this.time || time - this.time > 300
      || previous.width !== current.width || previous.height !== current.height || previous.mode !== current.mode
      || previous.screen.length < 21 || previous.landmarks.length < 21
      || current.screen.length < 21 || current.landmarks.length < 21) {
      this.reset(); this.previous = current; this.raw = current; this.time = time; return current;
    }
    const dt = Math.min(.1, (time - this.time) / 1000);
    const depthScale = ring.imageDepthScale ?? ring.handScale / .05;
    const depth = (p: HandPoint) => ring.imageDepthScale ? p.z : p.worldZ ?? p.z;
    const screen = [...current.screen], landmarks = [...current.landmarks];
    for (const ids of [[0], [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14], [15, 16], [17, 18, 19, 20]]) {
      const step = ids.reduce((sum, i) => sum.add(new Vector3(current.screen[i].x - raw.screen[i].x,
        current.screen[i].y - raw.screen[i].y, (depth(current.landmarks[i]) - depth(raw.landmarks[i])) * depthScale)), new Vector3()).multiplyScalar(1 / ids.length);
      const last = this.steps.get(ids[0]);
      const consistent = last && step.length() > .35 && last.length() > .35 && step.dot(last) / (step.length() * last.length()) > .7;
      const maximum = Math.max(...ids.map(i => Math.hypot(current.screen[i].x - previous.screen[i].x, current.screen[i].y - previous.screen[i].y)));
      const fast = step.length() > ring.width * .15 || ids.some(i =>
        Math.hypot(current.screen[i].x - raw.screen[i].x, current.screen[i].y - raw.screen[i].y) > ring.width * .22);
      const blend = 1 - Math.exp(-2 * Math.PI * (fast || consistent ? 20 : stationary ? 1.5 : 3) * dt);
      this.steps.set(ids[0], step);
      for (const i of ids) {
        const before = previous.screen[i], after = current.screen[i];
        const holdXY = !consistent && maximum < Math.max(.65, Math.min(1.4, ring.width * .018));
        screen[i] = holdXY ? before : { x: before.x + (after.x - before.x) * blend, y: before.y + (after.y - before.y) * blend };
        const old = previous.landmarks[i], next = current.landmarks[i];
        const zStep = Math.abs(depth(next) - depth(old)) * depthScale;
        const holdDepth = !consistent && zStep < Math.max(1, Math.min(3, ring.width * .03));
        landmarks[i] = { ...next, z: holdDepth ? old.z : old.z + (next.z - old.z) * blend,
          worldZ: old.worldZ !== undefined && next.worldZ !== undefined ? holdDepth ? old.worldZ : old.worldZ + (next.worldZ - old.worldZ) * blend : next.worldZ };
      }
    }
    // Z was measured relative to this filtered proximal bone, while XY always
    // remains in camera space. Preserve that depth reference with the mask.
    const result = { ...current, landmarks, screen };
    this.previous = result; this.raw = current; this.time = time;
    return result;
  }
}
