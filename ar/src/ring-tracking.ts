import { Matrix4, Quaternion, Vector3, MathUtils } from 'three';
import { MIN_FINGER_EDGE_CONFIDENCE } from './finger-silhouette.ts';

export type HandPoint = {
  x: number; y: number; z: number;
  worldX?: number; worldY?: number; worldZ?: number;
};
export type ScreenPoint = { x: number; y: number };
export type FingerMotionEvidence = { time: number; frontal: boolean; scale?: number; still?: boolean };
export type RingPlacement = ScreenPoint & {
  width: number;
  orientation: Quaternion;
  surfaceFacing: number;
  anchors: ScreenPoint[];
  fingerLength: number;
  handScale: number;
  fitRevision?: number;
  edgeConfidence?: number;
  imageDepthScale?: number;
  imageStill?: boolean;
  imagePoseStable?: boolean;
  scaleObserved?: boolean;
  fingerSegment?: { base: ScreenPoint; tip: ScreenPoint; fraction?: number };
  imageMotion?: { before: ScreenPoint[]; after: ScreenPoint[] };
};

const PALM_ANCHORS = [0, 5, 9, 13, 17];
// Distance must come from the palm: bending a finger is not a camera zoom.
const SCALE_BONES = [[0, 5], [0, 9], [0, 13], [0, 17], [5, 17]];
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const alpha = (hz: number, dt: number) => 1 - Math.exp(-2 * Math.PI * hz * dt);

export function detectionSize(width: number, height: number, maximum = 640) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function solveRingPose(
  landmarks: HandPoint[],
  screen: ScreenPoint[],
  handedness: 'Left' | 'Right' | null,
  mirrored: boolean,
  previousOrientation?: Quaternion,
  imageDepthScale?: number,
) {
  if (![0, 5, 9, 13, 14, 17].every(i => landmarks[i] && screen[i])) return null;
  const hasWorld = [0, 5, 9, 13, 14, 17].every(i =>
    [landmarks[i].worldX, landmarks[i].worldY, landmarks[i].worldZ].every(Number.isFinite));
  const mirror = mirrored ? -1 : 1;
  // The inference results remain unmirrored. Convert to display coordinates
  // exactly once, here. Image XY supplies alignment; world coordinates supply
  // the depth and surface orientation, not a second independently fitted XY.
  const worldPoint = (i: number) => {
    const p = landmarks[i];
    return hasWorld
      ? new Vector3(p.worldX! * mirror, -p.worldY!, -p.worldZ!)
      : new Vector3(screen[i].x, -screen[i].y, 0);
  };
  const imageDepth = imageDepthScale !== undefined && imageDepthScale > 0
    && [0, 5, 9, 13, 14, 17].every(i => Number.isFinite(landmarks[i].z));
  // Image-relative depth belongs to the same projected skeleton as screen XY.
  // Mixing its XY with a separately inferred world normal produced sideways
  // settings on straight fingers and disagreement with the occlusion surface.
  const cameraPoint = (i: number) => imageDepth
    ? new Vector3(screen[i].x, -screen[i].y, -landmarks[i].z * imageDepthScale!)
    : worldPoint(i);
  const worldFinger = cameraPoint(14).sub(cameraPoint(13));
  const dx = screen[14].x - screen[13].x;
  const dy = screen[13].y - screen[14].y;
  const fingerLength = Math.hypot(dx, dy);
  if (fingerLength < 2 || worldFinger.lengthSq() < 1e-10) return null;
  const index = cameraPoint(5).sub(cameraPoint(0));
  const pinky = cameraPoint(17).sub(cameraPoint(0));
  const normal = new Vector3().crossVectors(index, pinky);
  if (normal.lengthSq() < 1e-10) return null;
  normal.normalize();
  // LR1844's stone lies along native -Z. Anatomical handedness fixes the sign
  // for the entire turn; choosing a camera-facing sign each frame causes a
  // half-turn jump at an edge-on pose.
  if (handedness) normal.multiplyScalar((handedness === 'Right' ? 1 : -1) * mirror);
  else if (previousOrientation) {
    const previousNormal = new Vector3(0, 0, 1).applyQuaternion(previousOrientation);
    if (normal.dot(previousNormal) < 0) normal.negate();
  }
  // Leave room for an observed steep pitch. The old .92 cap stopped the ring
  // near 67 degrees even while the projected finger still supplied a clear axis.
  let depth = MathUtils.clamp(worldFinger.clone().normalize().z, -0.985, 0.985);
  // On an open palm the monocular depth model biases the proximal bone toward
  // the camera. Attenuate that bias continuously only in a clear palm view,
  // keeping the rear shank narrow. Side views and dorsal pitch remain free.
  const palmProfile = MathUtils.smoothstep(normal.z, 0.45, 0.9);
  if (!imageDepth) depth *= 1 - 0.92 * palmProfile;
  const projected = Math.sqrt(1 - depth * depth);
  const yAxis = new Vector3(dx / fingerLength * projected, dy / fingerLength * projected, depth);
  normal.addScaledVector(yAxis, -normal.dot(yAxis));
  if (normal.lengthSq() < 1e-8) return null;
  normal.normalize();
  const xAxis = new Vector3().crossVectors(yAxis, normal).normalize();
  const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize();
  const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
  let metricOrientation: Quaternion | undefined;

  if (imageDepth && hasWorld) {
    // Image-relative Z can add a persistent depth ramp to an otherwise frontal
    // hand. The independently inferred metric pose helps reject that ramp,
    // but only when it strongly supports a frontal view. Keep image depth for
    // side views and when the two estimates agree, so real turns remain free.
    const metricPose = solveRingPose(landmarks, screen, handedness, mirrored, previousOrientation);
    if (metricPose) {
      const metricNormal = new Vector3(0, 0, 1).applyQuaternion(metricPose.orientation);
      const metricDepth = MathUtils.clamp(worldPoint(14).sub(worldPoint(13)).normalize().z, -0.985, 0.985);
      const metricProjected = Math.sqrt(1 - metricDepth * metricDepth);
      const metricAxis = new Vector3(dx / fingerLength * metricProjected, dy / fingerLength * metricProjected, metricDepth);
      const observedMetricNormal = new Vector3().crossVectors(worldPoint(5).sub(worldPoint(0)), worldPoint(17).sub(worldPoint(0))).normalize();
      if (observedMetricNormal.dot(metricNormal) < 0) observedMetricNormal.negate();
      observedMetricNormal.addScaledVector(metricAxis, -observedMetricNormal.dot(metricAxis)).normalize();
      const metricX = new Vector3().crossVectors(metricAxis, observedMetricNormal).normalize();
      const observedMetric = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(metricX, metricAxis, observedMetricNormal));
      metricOrientation = observedMetric;
      const sameSide = metricNormal.z * zAxis.z > 0;
      const correction = sameSide ? 0.94
        * MathUtils.smoothstep(Math.abs(metricNormal.z), 0.94, 0.975)
        * MathUtils.smoothstep(Math.abs(zAxis.z), 0.82, 0.9)
        // Compare the two measurements before the metric palm-pitch prior.
        // Otherwise that prior would also flatten a real, agreed small tilt.
        * MathUtils.smoothstep(orientation.angleTo(observedMetric), 0.04, 0.12) : 0;
      // Neither conflicting depth ramp is a reliable surface offset. Use the
      // frontal finger frame as the prior, keeping the setting centered on
      // the fitted cross-section on both sides (including the hidden setting).
      const frontalAxis = new Vector3(dx / fingerLength, dy / fingerLength, 0);
      const frontalNormal = new Vector3(0, 0, Math.sign(zAxis.z));
      const frontalX = new Vector3().crossVectors(frontalAxis, frontalNormal);
      const frontal = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(frontalX, frontalAxis, frontalNormal));
      orientation.slerp(frontal, correction);
      // Reconcile depth only; the visible proximal bone still owns screen roll.
      const correctedAxis = new Vector3(0, 1, 0).applyQuaternion(orientation);
      const roll = Math.atan2(dy, dx) - Math.atan2(correctedAxis.y, correctedAxis.x);
      orientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));
    }
  }

  // Estimate distance from several projected metric bones. A single screen
  // bone shortens on a tilt, which used to shrink/freeze the ring's diameter.
  const scales: number[] = [];
  if (hasWorld) for (const [a, b] of SCALE_BONES) {
    if (!landmarks[a] || !landmarks[b] || !screen[a] || !screen[b]) continue;
    const bone = worldPoint(b).sub(worldPoint(a));
    const projectedLength = Math.hypot(bone.x, bone.y);
    if (projectedLength < bone.length() * 0.45 || projectedLength < 0.008) continue;
    const pixels = Math.hypot(screen[b].x - screen[a].x, screen[b].y - screen[a].y);
    if (pixels > 4) scales.push(pixels / projectedLength * 0.05);
  }
  const handScale = scales.length > 0 ? median(scales) : fingerLength / Math.max(0.4, projected);
  return { orientation, metricOrientation, facing: Math.abs(new Vector3(0, 0, 1).applyQuaternion(orientation).z), handScale, fingerLength, imageDepth, anchors: PALM_ANCHORS.map(i => screen[i]) };
}

export function projectedFingerAxis(orientation: Quaternion) {
  const axis = new Vector3(0, 1, 0).applyQuaternion(orientation);
  const length = Math.hypot(axis.x, axis.y);
  return { x: axis.x / Math.max(length, 1e-6), y: -axis.y / Math.max(length, 1e-6) };
}

// The 3D model can invent finger pitch/twist even when the image is flat.
// Bound that pose using the same front-facing reference that locked the fit.
// Knuckle width constrains twist; proximal length constrains bone pitch.
// Palm area is used only to distinguish the palm from the back of the hand.
export class RingSurfaceConstraint {
  private reference: { area: number; span: number; fullSpan: number; length: number; width: number; side: number; frontal: boolean } | null = null;
  reset() { this.reference = null; }
  update(orientation: Quaternion, anchors: ScreenPoint[], fingerLength: number, width: number, imageDepth = false, metricOrientation?: Quaternion) {
    const normal = new Vector3(0, 0, 1).applyQuaternion(orientation);
    const measuredNormal = normal.clone();
    const axis = new Vector3(0, 1, 0).applyQuaternion(orientation);
    if (anchors.length < 5 || !(width > 0) || !(fingerLength > 0)) return orientation.clone();
    const [wrist, index, , , pinky] = anchors;
    const area = (index.x - wrist.x) * (pinky.y - wrist.y) - (index.y - wrist.y) * (pinky.x - wrist.x);
    if (!Number.isFinite(area) || (!this.reference && Math.abs(area) < 1)) return orientation.clone();
    const xy = Math.hypot(axis.x, axis.y);
    if (xy < 1e-6) return orientation.clone();
    const middle = anchors[2];
    const span = Math.abs((middle.x - pinky.x) * axis.y / xy + (middle.y - pinky.y) * axis.x / xy);
    const fullSpan = Math.abs((index.x - pinky.x) * axis.y / xy + (index.y - pinky.y) * axis.x / xy);
    const frontal = Math.abs(normal.z) > 0.94 && Math.abs(axis.z) < 0.25;
    if (!this.reference || (imageDepth && !this.reference.frontal && frontal)) {
      if (span < width * 0.1) return orientation.clone();
      this.reference = { area, span, fullSpan, length: fingerLength, width, side: Math.sign(normal.z) || 1, frontal };
    }
    const reference = this.reference;
    const zoom = width / reference.width;
    const side = Math.sign(area / reference.area) * reference.side || Math.sign(normal.z) || reference.side;
    if (imageDepth) {
      // Preserve the observed pitch and twist. The image area only resolves
      // anatomy if handedness briefly changes; it must not flatten a real tilt.
      if (normal.z * side < 0 && Math.abs(area / reference.area) > 0.08) normal.negate();
      if (metricOrientation) {
        // Cropped hands can produce a radically different metric depth ramp.
        // Matching only its sign amplified the sideways setting in the Oct 29
        // captures. Independent twist may strengthen a pose only while the
        // two estimates remain reasonably close. Pitch has a separate direct
        // check below: visible shortening of the proximal finger segment.
        const metricAgreement = 1 - MathUtils.smoothstep(orientation.angleTo(metricOrientation), .3, .65);
        const metricAxis = new Vector3(0, 1, 0).applyQuaternion(metricOrientation);
        const metricNormal = new Vector3(0, 0, 1).applyQuaternion(metricOrientation);
        // A shortened proximal segment validates pitch independently of either
        // depth network. Lateral knuckle compression validates sideways turns.
        // Treat these separately: curling a finger must not invent palm twist.
        const lengthRatio = fingerLength / (reference.length * zoom);
        const acrossRatio = Math.min(span / (reference.span * zoom), fullSpan / (reference.fullSpan * zoom));
        const pitchEvidence = 1 - MathUtils.smoothstep(lengthRatio, 0.5, 0.9);
        const turnEvidence = (1 - MathUtils.smoothstep(acrossRatio, 0.75, 0.97))
          * MathUtils.smoothstep(lengthRatio, 0.65, 0.9);
        const facingFrame = (a: Vector3) => {
          const front = new Vector3(0, 0, side).addScaledVector(a, -side * a.z).normalize();
          return { front, across: new Vector3().crossVectors(a, front).normalize() };
        };
        const frame = facingFrame(axis), metricFrame = facingFrame(metricAxis);
        const turn = Math.atan2(normal.dot(frame.across), normal.dot(frame.front));
        const metricTurn = Math.atan2(metricNormal.dot(metricFrame.across), metricNormal.dot(metricFrame.front));
        // Only strengthen an already observed direction. Conflicting estimates
        // and a camera-facing metric pose cannot reverse or flatten a turn.
        const agrees = (a: number, b: number) => a * b > 0 && Math.abs(b) > Math.abs(a);
        const depth = agrees(axis.z, metricAxis.z)
          ? MathUtils.lerp(axis.z, metricAxis.z, 0.85 * pitchEvidence) : axis.z;
        const correctedTurn = metricNormal.z * side > 0 && agrees(turn, metricTurn)
          ? MathUtils.lerp(turn, metricTurn, 0.85 * turnEvidence * metricAgreement) : turn;
        axis.set(axis.x / xy * Math.sqrt(1 - depth * depth), axis.y / xy * Math.sqrt(1 - depth * depth), depth);
        const correctedFrame = facingFrame(axis);
        normal.copy(correctedFrame.front).multiplyScalar(Math.cos(correctedTurn))
          .addScaledVector(correctedFrame.across, Math.sin(correctedTurn)).normalize();
      }
      const x = new Vector3().crossVectors(axis, normal).normalize();
      return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, axis,
        new Vector3().crossVectors(x, axis).normalize()));
    }
    // Image shortening limits extreme pitch. Small measured pitch remains
    // observable before enough shortening appears in the projected bone.
    const projected = MathUtils.clamp(fingerLength / (reference.length * zoom), 0, 1);
    const maximumDepth = Math.max(0.35, projected >= 0.93 ? 0 : Math.sqrt(1 - (projected / 0.93) ** 2));
    const depth = MathUtils.clamp(axis.z, -maximumDepth, maximumDepth);
    const projectedAxis = Math.sqrt(1 - depth * depth);
    axis.set(axis.x / xy * projectedAxis, axis.y / xy * projectedAxis, depth);
    // Bending the finger shortens the palm image too. Treating that area
    // reduction as sideways twist placed the stone beside the finger.
    const across = MathUtils.clamp(span / (reference.span * zoom), 0, 1);
    const cosine = across >= 0.93 ? 1 : across / 0.93;
    const facingNormal = new Vector3(0, 0, side).addScaledVector(axis, -side * axis.z).normalize();
    const acrossAxis = new Vector3().crossVectors(axis, facingNormal).normalize();
    // Foreshortening bounds a turn; it does not measure its signed angle.
    // Assigning the entire bound with Math.sign amplified an almost-zero
    // normal into alternating large left/right rotations on a still hand.
    const measuredTurn = Math.atan2(normal.dot(acrossAxis), normal.dot(facingNormal));
    // Near frontal, a real 20-degree turn shortens a palm span by only 6%.
    // Finger spread can cancel even that change. Leave a measured +/-32-degree
    // range available; temporal filtering, not a camera-facing clamp, removes
    // noise there. Larger turns still need image foreshortening evidence.
    const maximumTurn = Math.max(0.56, Math.acos(cosine));
    const turn = MathUtils.clamp(measuredTurn, -maximumTurn, maximumTurn);
    normal.copy(facingNormal).multiplyScalar(Math.cos(turn))
      .addScaledVector(acrossAxis, Math.sin(turn)).normalize();
    // Finger spread changes knuckle width even at the same camera angle.
    // A frontal reference may stabilize frontal poses, but must not flatten
    // a clearly observed sideways turn into a camera-facing stone.
    const fullAcross = fullSpan / Math.max(1e-6, reference.fullSpan * zoom);
    const sideEvidence = (1 - MathUtils.smoothstep(Math.abs(measuredNormal.z), 0.65, 0.93))
      * (1 - MathUtils.smoothstep(fullAcross, 0.82, 0.98));
    measuredNormal.addScaledVector(axis, -measuredNormal.dot(axis));
    if (measuredNormal.lengthSq() > 1e-8) {
      measuredNormal.normalize();
      normal.lerp(measuredNormal, sideEvidence).normalize();
    }
    const x = new Vector3().crossVectors(axis, normal).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, axis, new Vector3().crossVectors(x, axis).normalize()));
  }
}

// Least-squares screen similarity from the rigid palm, used to carry the last
// stable ring attachment with the current video frame before filtering noise.
export function fitPalmMotion(before: ScreenPoint[], after: ScreenPoint[]) {
  if (before.length !== after.length || before.length < 3) return null;
  const n = before.length;
  const center = (points: ScreenPoint[]) => points.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
  const p = center(before), q = center(after);
  let denom = 0, real = 0, imag = 0;
  for (let i = 0; i < n; i++) {
    const px = before[i].x - p.x, py = before[i].y - p.y;
    const qx = after[i].x - q.x, qy = after[i].y - q.y;
    denom += px * px + py * py;
    real += px * qx + py * qy;
    imag += px * qy - py * qx;
  }
  if (denom < 1e-12) return null;
  const a = real / denom, b = imag / denom;
  const map = (point: ScreenPoint) => ({
    x: q.x + a * (point.x - p.x) - b * (point.y - p.y),
    y: q.y + b * (point.x - p.x) + a * (point.y - p.y),
  });
  const residual = Math.sqrt(before.reduce((sum, point, i) => {
    const projected = map(point);
    return sum + (projected.x - after[i].x) ** 2 + (projected.y - after[i].y) ** 2;
  }, 0) / n);
  return { map, scale: Math.hypot(a, b), angle: Math.atan2(b, a), residual };
}

/** Confirm out-of-plane motion over elapsed time, not a minimum angle per
 * frame. Slow turns and low/variable frame rates need the same response.
 * Non-rigid image shape must support the measured normal: translation, zoom,
 * screen roll and unsupported depth drift alone never confirm a turn. */
class ObservedHandTurn {
  private samples: { pose: RingPlacement; time: number }[] = [];
  private activeUntil = 0;
  reset() { this.samples = []; this.activeUntil = 0; }
  update(pose: RingPlacement, time: number) {
    if (pose.imageStill || pose.imagePoseStable) this.reset();
    const last = this.samples[this.samples.length - 1];
    if (last && (time <= last.time || time - last.time > 300)) this.reset();
    this.samples.push({ pose, time });
    while (this.samples.length > 2 && time - this.samples[1].time > 220) this.samples.shift();
    if (pose.imageStill || pose.imagePoseStable || this.samples.length < 3) return false;
    const first = this.samples[0], elapsed = time - first.time;
    const motion = fitPalmMotion(first.pose.anchors, pose.anchors);
    if (!motion) return false;
    const axis = projectedFingerAxis(pose.orientation), oldAxis = projectedFingerAxis(first.pose.orientation);
    const roll = Math.atan2(axis.y, axis.x) - Math.atan2(oldAxis.y, oldAxis.x) - motion.angle;
    const imageChanged = motion.residual > Math.max(.15, pose.width * .004)
      || Math.abs(pose.fingerLength / Math.max(1, first.pose.fingerLength * motion.scale) - 1) > .012
      || Math.abs(Math.atan2(Math.sin(roll), Math.cos(roll))) > .015;
    let path = 0;
    for (let i = 1; i < this.samples.length; i++) path += this.samples[i - 1].pose.orientation.angleTo(this.samples[i].pose.orientation);
    const net = first.pose.orientation.angleTo(pose.orientation);
    const coherent = elapsed >= 65 && net > .025 && net > path * .72 && net * 1000 / elapsed > .12;
    const a = this.samples[this.samples.length - 3], b = this.samples[this.samples.length - 2];
    const delta = (before: Quaternion, after: Quaternion) => {
      const q = after.clone().multiply(before.clone().invert());
      return new Vector3(q.x, q.y, q.z).multiplyScalar(q.w < 0 ? -1 : 1);
    };
    const before = delta(a.pose.orientation, b.pose.orientation), after = delta(b.pose.orientation, pose.orientation);
    const direction = before.length() * after.length();
    const continuing = time < this.activeUntil && direction > 1e-10 && before.dot(after) / direction > .7
      && b.pose.orientation.angleTo(pose.orientation) * 1000 / Math.max(1, time - b.time) > .12;
    const confirmed = imageChanged && (coherent || continuing);
    if (confirmed) this.activeUntil = time + 180;
    return confirmed;
  }
}

export class RingPoseFilter {
  private state: { raw: RingPlacement; value: RingPlacement; time: number; angularStep: Vector3; localStep: ScreenPoint } | null = null;
  private detectionMissing = false;
  private observedHandTurn = new ObservedHandTurn();
  private heldAnchor: ScreenPoint | null = null;
  private heldScale = 1;
  private heldAngle = 0;
  private refitUntil = 0;
  private uncertainTurnFrames = 0;
  private uncertainLocalFrames = 0;
  private stableTurnFrames = 0;
  private shapeReference: { anchors: ScreenPoint[]; length: number; axis: ScreenPoint } | null = null;
  private poseReleaseUntil = 0;
  private lastTextureTime = -Infinity;
  private turnCandidate: { orientation: Quaternion; since: number } | null = null;
  private confirmedTurnUntil = 0;
  private attachmentRecenterUntil = 0;
  private skinTarget: ScreenPoint | null = null;
  private anatomicalAnchor: ScreenPoint | null = null;
  private scaleStep = 0;
  private scaleMoveFrames = 0;
  private palmStep: ScreenPoint = { x: 0, y: 0 };
  private palmMoveFrames = 0;
  private pendingRoll = 0;
  private rollCandidate: { angle: number; since: number } | null = null;
  private rollAlignmentUntil = 0;
  private motionGap: { raw: RingPlacement; attachment: ScreenPoint; time: number } | null = null;
  private imageScaleStep = 0;
  private imageScaleFrames = 0;
  private zoomReleaseUntil = 0;
  private turnFollowUntil = 0;
  reset() { this.observedHandTurn.reset(); this.detectionMissing = false; this.state = null; this.heldAnchor = null; this.heldScale = 1; this.heldAngle = 0; this.refitUntil = 0; this.uncertainTurnFrames = 0; this.uncertainLocalFrames = 0; this.stableTurnFrames = 0; this.shapeReference = null; this.poseReleaseUntil = 0; this.lastTextureTime = -Infinity; this.turnCandidate = null; this.confirmedTurnUntil = 0; this.attachmentRecenterUntil = 0; this.skinTarget = null; this.anatomicalAnchor = null; this.scaleStep = 0; this.scaleMoveFrames = 0; this.palmStep = { x: 0, y: 0 }; this.palmMoveFrames = 0; this.pendingRoll = 0; this.rollCandidate = null; this.rollAlignmentUntil = 0; this.motionGap = null; this.imageScaleStep = 0; this.imageScaleFrames = 0; this.zoomReleaseUntil = 0; this.turnFollowUntil = 0; }
  current() { return this.state?.value; }
  update(raw: RingPlacement | null, time: number) {
    const previous = this.state;
    if (!raw) {
      this.detectionMissing = true;
      // Hide a stale overlay promptly, but retain the fitted attachment across
      // a short detector dropout. Re-seeding on one missed frame made the ring
      // jump to the next noisy landmark instead of returning to the same skin.
      if (!previous || time - previous.time > 300) this.reset();
      return this.state && time - this.state.time <= 55 ? this.state.value : null;
    }
    const reacquired = this.detectionMissing;
    this.detectionMissing = false;
    const movedAway = previous && Math.hypot(raw.x - previous.value.x, raw.y - previous.value.y) > raw.width * .75;
    // Slow camera/GPU frames should not bypass all stabilization. Missing-hand
    // frames still use the short loss timeout above.
    if (!previous || (reacquired && (time - previous.time > 300 || movedAway)) || (time - previous.time > 1200 && raw.imageStill !== true)) {
      this.reset();
      this.state = { raw, value: { ...raw, orientation: raw.orientation.clone() }, time, angularStep: new Vector3(), localStep: { x: 0, y: 0 } };
      this.observedHandTurn.update(raw, time);
      return this.state.value;
    }
    if (reacquired) {
      // Flow was reset while no anatomy was visible. Do not apply the old
      // texture grace period to the newly observed frame's palm transport.
      this.lastTextureTime = -Infinity; this.motionGap = null;
      this.skinTarget = null; this.heldAnchor = null;
      this.heldScale = 1; this.heldAngle = 0; this.pendingRoll = 0;
    }
    // Missing frames do not establish a trustworthy movement trajectory. Avoid
    // spending their whole elapsed time chasing a noisy re-detection in one
    // step; measured palm transport below still follows real displacement.
    const dt = MathUtils.clamp((time - previous.time) / 1000, 0.001, reacquired ? 1 / 60 : 0.1);
    const weakEdges = raw.edgeConfidence !== undefined && raw.edgeConfidence < MIN_FINGER_EDGE_CONFIDENCE;
    const refitted = raw.fitRevision !== previous.value.fitRevision;
    if (refitted) this.refitUntil = time + 400;
    const usableMotion = (motion: ReturnType<typeof fitPalmMotion>) =>
      motion && motion.residual < Math.max(2, raw.width * 0.09) && motion.scale > 0.7 && motion.scale < 1.4 ? motion : null;
    const imageMotion = raw.imageMotion
      ? usableMotion(fitPalmMotion(raw.imageMotion.before, raw.imageMotion.after)) : null;
    const textureReacquired = imageMotion !== null && previous.time - this.lastTextureTime > 0.5;
    if (!imageMotion && previous.time === this.lastTextureTime && raw.imageStill !== true) {
      const attachment = this.heldAnchor ?? this.skinTarget ?? previous.value;
      this.motionGap = { raw: previous.raw,
        attachment: { x: attachment.x, y: attachment.y }, time: previous.time };
    }
    if (this.motionGap && (time - this.motionGap.time > 350 || raw.imageStill === true)) this.motionGap = null;
    if (imageMotion) this.lastTextureTime = time;
    const observedScale = raw.imageMotion && imageMotion
      ? skinScaleEvidence(raw.imageMotion.before, raw.imageMotion.after) : undefined;
    const skinDeformation = raw.imageMotion && imageMotion
      ? skinAnisotropy(raw.imageMotion.before, raw.imageMotion.after) : undefined;
    const imageScaleStep = observedScale === undefined ? 0 : Math.log(observedScale);
    this.imageScaleFrames = Math.abs(imageScaleStep) > 0.0015
      ? imageScaleStep * this.imageScaleStep > 0 ? this.imageScaleFrames + 1 : 1 : 0;
    this.imageScaleStep = imageScaleStep;
    if (this.imageScaleFrames >= 2 || Math.abs(imageScaleStep) > 0.06) this.zoomReleaseUntil = time + 250;
    const observedZoom = time < this.zoomReleaseUntil || raw.scaleObserved === true;
    const palmMotion = fitPalmMotion(previous.raw.anchors, raw.anchors);
    // Keep a fixed image-shape reference, so a slow real turn accumulates
    // enough evidence to release the depth hold. Translation, roll and zoom
    // alone should carry the attachment without changing its depth rotation.
    if (!this.shapeReference) this.shapeReference = {
      anchors: previous.raw.anchors.map(p => ({ ...p })), length: previous.raw.fingerLength,
      axis: projectedFingerAxis(previous.raw.orientation),
    };
    const reference = this.shapeReference;
    const shapeMotion = fitPalmMotion(reference.anchors, raw.anchors);
    const fingerAxis = projectedFingerAxis(raw.orientation);
    const referenceAxisAngle = Math.atan2(reference.axis.y, reference.axis.x) + (shapeMotion?.angle ?? 0);
    const axisDifference = Math.atan2(fingerAxis.y, fingerAxis.x) - referenceAxisAngle;
    const shapeChanged = !shapeMotion || shapeMotion.residual > raw.width * 0.015
      || Math.abs(raw.fingerLength / Math.max(1, reference.length * shapeMotion.scale) - 1) > 0.025
      || Math.abs(Math.atan2(Math.sin(axisDifference), Math.cos(axisDifference))) > 0.035;
    if (shapeChanged) {
      this.poseReleaseUntil = time + 220;
      this.shapeReference = { anchors: raw.anchors.map(p => ({ ...p })), length: raw.fingerLength, axis: fingerAxis };
    }
    // One missed skin match must not switch depth back to the noisy model.
    // Shape changes and longer tracking losses release this brief grace period.
    const texturePoseHold = time - this.lastTextureTime <= 180 && !shapeChanged && time >= this.poseReleaseUntil;
    // A stationary texture patch observes translation, not the finger's 3D
    // surface normal. A persistent new normal must be allowed through even
    // when its projected palm shape changes too little to detect a small tilt.
    const candidate = this.turnCandidate;
    if (raw.imagePoseStable) {
      // Confirmed, nearly unchanged skin pixels outrank an inferred normal
      // that wanders into a new pose for a few frames on a stationary hand.
      this.turnCandidate = null; this.confirmedTurnUntil = 0; this.turnFollowUntil = 0;
    } else if (!candidate || candidate.orientation.angleTo(raw.orientation) > 0.06) {
      this.turnCandidate = { orientation: raw.orientation.clone(), since: time };
    } else if (time - candidate.since >= 160 && previous.value.orientation.angleTo(raw.orientation) > 0.045) {
      this.confirmedTurnUntil = time + 220;
    }
    const confirmedTurn = time < this.confirmedTurnUntil;
    const pitched = !raw.imagePoseStable && shapeChanged && raw.orientation.angleTo(previous.raw.orientation) > 0.15
      && Math.abs(raw.fingerLength / Math.max(1, previous.raw.fingerLength) - 1) > 0.06;
    if (confirmedTurn || pitched) this.attachmentRecenterUntil = time + 600;
    const previousAxis = projectedFingerAxis(previous.value.orientation);
    const rollDifference = Math.atan2(fingerAxis.y, fingerAxis.x)
      - Math.atan2(previousAxis.y, previousAxis.x) - (imageMotion?.angle ?? 0);
    const rollError = Math.atan2(Math.sin(rollDifference), Math.cos(rollDifference));
    if (raw.imagePoseStable || !imageMotion || Math.abs(rollError) < 0.045) this.rollCandidate = null;
    else if (!this.rollCandidate || Math.abs(rollError - this.rollCandidate.angle) > 0.018) {
      this.rollCandidate = { angle: rollError, since: time };
    } else if (time - this.rollCandidate.since >= 450) {
      this.rollAlignmentUntil = time + 600;
      this.rollCandidate = null;
    }
    if (raw.imagePoseStable) this.rollAlignmentUntil = 0;
    const alignRoll = !raw.imagePoseStable && imageMotion !== null && time < this.rollAlignmentUntil;
    const motion = imageMotion ?? usableMotion(palmMotion);
    const reliable = motion !== null;
    let carried = motion ? motion.map(imageMotion ? this.skinTarget ?? previous.value : previous.value) : previous.value;
    const mappedAttachment = palmMotion?.map(previous.raw);
    const segment = raw.fingerSegment, oldSegment = previous.raw.fingerSegment;
    const palmDisplacement = mappedAttachment
      ? Math.hypot(mappedAttachment.x - previous.raw.x, mappedAttachment.y - previous.raw.y) : 0;
    const fastDisplacement = palmDisplacement > Math.max(8, raw.width * 0.3)
      || (palmDisplacement > Math.max(6, raw.width * 0.12)
        && palmDisplacement / Math.max(1, raw.width) / Math.max(0.001, (time - previous.time) / 1000) > 6);
    const palmTolerance = Math.max(1.5, raw.width * 0.04);
    const followsPalm = (before: ScreenPoint, after: ScreenPoint) => {
      const mapped = palmMotion!.map(before);
      return Math.hypot(mapped.x - after.x, mapped.y - after.y) < palmTolerance;
    };
    // A fast hand movement often blurs the skin matches. A large, rigid palm
    // displacement that also carries both finger endpoints and the attachment
    // can transport the established offset immediately, including on reversal.
    // Local joint spikes and verified stationary pixels keep the dropout hold.
    const fastPalmTransport = !imageMotion && raw.imageStill !== true && motion !== null
      && palmMotion !== null && palmMotion.residual < Math.max(1, raw.width * 0.015)
      && mappedAttachment !== undefined && segment !== undefined && oldSegment !== undefined
      && fastDisplacement
      && followsPalm(previous.raw, raw) && followsPalm(oldSegment.base, segment.base) && followsPalm(oldSegment.tip, segment.tip);
    const palmStep = { x: carried.x - previous.value.x, y: carried.y - previous.value.y };
    const stepProduct = Math.hypot(palmStep.x, palmStep.y) * Math.hypot(this.palmStep.x, this.palmStep.y);
    const consistentTranslation = !imageMotion && stepProduct > 0.1
      && (palmStep.x * this.palmStep.x + palmStep.y * this.palmStep.y) / stepProduct > 0.85;
    this.palmMoveFrames = consistentTranslation ? this.palmMoveFrames + 1 : 0;
    this.palmStep = palmStep;
    // Losing one skin match must not hand the attachment straight to a large
    // skeletal jump. Give coherent palm movement two frames to establish its
    // direction during the brief texture grace period.
    const textureDropout = !imageMotion && !fastPalmTransport && time - this.lastTextureTime <= 180 && this.palmMoveFrames < 2;
    if (textureDropout || (!imageMotion && this.palmMoveFrames < 2 && Math.hypot(palmStep.x, palmStep.y) < raw.width * (weakEdges ? 0.18 : 0.06))) {
      const blend = alpha(textureDropout ? 0.45 : 1.25, dt);
      carried = { x: MathUtils.lerp(previous.value.x, carried.x, blend), y: MathUtils.lerp(previous.value.y, carried.y, blend) };
    }
    const textureAnchor = imageMotion ? imageMotion.map(this.heldAnchor ?? this.skinTarget ?? previous.value) : null;
    const textureScale = this.heldScale * (imageMotion?.scale ?? 1);
    const textureAngle = this.heldAngle + this.pendingRoll + (imageMotion?.angle ?? 0);
    // Skin texture is independent evidence that the finger did not move.
    // Do not slowly chase drifting landmarks (including their scale/depth)
    // while the captured image stays still. Real texture motion releases this
    // hold immediately; large pose changes also release an unreliable match.
    // Individual patch points shimmer with exposure and compression. Measure
    // their agreed motion at the attachment, not RMS noise across every point.
    const imageCenter = imageMotion?.map(previous.value);
    const textureMotion = imageCenter ? Math.hypot(imageCenter.x - previous.value.x, imageCenter.y - previous.value.y) : Infinity;
    let gapRecovered = false;
    if (this.motionGap && imageMotion) {
      const gap = this.motionGap;
      const gapMotion = usableMotion(fitPalmMotion(gap.raw.anchors, raw.anchors));
      const close = (map: (p: ScreenPoint) => ScreenPoint, before: ScreenPoint, after: ScreenPoint) => {
        const projected = map(before);
        return Math.hypot(projected.x - after.x, projected.y - after.y) < palmTolerance;
      };
      // Incremental texture after a missed frame cannot recover the displacement
      // lost in that frame. Reconcile the short gap only when moving skin agrees
      // with the current joints and a rigid palm carries both finger endpoints.
      // Transport the previously fitted offset rather than snapping to raw joints.
      if ((raw.imageMotion?.after.length ?? 0) >= 6 && raw.imageStill !== true
        && textureMotion > Math.max(1, raw.width * 0.015)
        && gapMotion && gapMotion.residual < Math.max(1, raw.width * 0.015)
        && gap.raw.fingerSegment && raw.fingerSegment
        && close(imageMotion.map, previous.raw, raw)
        && close(gapMotion.map, gap.raw, raw)
        && close(gapMotion.map, gap.raw.fingerSegment.base, raw.fingerSegment.base)
        && close(gapMotion.map, gap.raw.fingerSegment.tip, raw.fingerSegment.tip)) {
        carried = gapMotion.map(gap.attachment);
        gapRecovered = true;
        this.heldAnchor = null; this.skinTarget = carried;
        this.anatomicalAnchor = { x: previous.value.x, y: previous.value.y };
      }
      this.motionGap = null;
    }
    if (textureReacquired && !gapRecovered && raw.imageStill !== true && imageMotion && (raw.imageMotion?.after.length ?? 0) >= 6
      && textureMotion > Math.max(3, raw.width * 0.08)
      && Math.hypot(raw.x - carried.x, raw.y - carried.y) > raw.width * 0.25) {
      const transportedRaw = imageMotion.map(previous.raw);
      // A missing match can leave the accumulated attachment a finger-width
      // behind. On reacquisition, agreeing skin and joint displacement locate
      // the finger again; the small correction budget would keep the old error
      // indefinitely. Stationary texture and isolated joint spikes cannot reset it.
      if (Math.hypot(transportedRaw.x - raw.x, transportedRaw.y - raw.y) < Math.max(3, raw.width * 0.1)) {
        carried = { x: raw.x, y: raw.y };
        this.heldAnchor = null;
        this.skinTarget = carried;
        // The bone constraint below transports this previous-frame anchor by
        // the new displacement; seeding it at the current pose would move twice.
        this.anatomicalAnchor = { x: previous.value.x, y: previous.value.y };
      }
    }
    const rawTurn = previous.raw.orientation.angleTo(raw.orientation);
    const delta = raw.orientation.clone().multiply(previous.raw.orientation.clone().invert());
    const angularStep = new Vector3(delta.x, delta.y, delta.z).multiplyScalar(delta.w < 0 ? -1 : 1);
    const directionAgreement = angularStep.lengthSq() > 1e-10 && previous.angularStep.lengthSq() > 1e-10
      ? angularStep.clone().normalize().dot(previous.angularStep.clone().normalize()) : 0;
    const skeletalTurn = this.observedHandTurn.update(raw, time);
    const stillRadius = Math.max(0.55, Math.min(1.25, raw.width * 0.012));
    // A noisy knuckle can change the landmark shape without changing the image.
    // Independent, undeformed skin matches keep a small alternating depth error
    // stationary. A coherent turn, clear bend or persistent normal releases it.
    const smallShapeNoise = shapeChanged && !pitched && !confirmedTurn
      && !(rawTurn > 0.015 && directionAgreement > 0.7)
      && observedScale !== undefined && Math.abs(observedScale - 1) < 0.008
      && imageMotion !== null && imageMotion.residual < Math.max(0.75, raw.width * 0.015)
      && raw.orientation.angleTo(previous.value.orientation) < 0.12
      && Math.abs(raw.fingerLength / previous.value.fingerLength - 1) < 0.04;
    const recenterAttachment = imageMotion !== null && time < this.attachmentRecenterUntil
      && Math.hypot(raw.x - carried.x, raw.y - carried.y) > raw.width * 0.02;
    const still = time >= this.refitUntil && !raw.scaleObserved && (raw.imageStill === true || (!raw.imagePoseStable && !skeletalTurn && !observedZoom && !recenterAttachment && (!shapeChanged || smallShapeNoise) && !confirmedTurn && !alignRoll && textureMotion < stillRadius
      && imageMotion !== null && imageMotion.residual < Math.max(0.75, raw.width * 0.02) && textureAnchor !== null
      && Math.hypot(textureAnchor.x - previous.value.x, textureAnchor.y - previous.value.y) < stillRadius
      && Math.abs(textureScale - 1) < 0.015 && Math.abs(textureAngle) < 0.008
      && Math.hypot(raw.x - previous.value.x, raw.y - previous.value.y) < raw.width * 0.18
      && (texturePoseHold || raw.orientation.angleTo(previous.value.orientation) < 0.3)
      && Math.abs(raw.fingerLength / previous.value.fingerLength - 1) < 0.08
      && Math.abs(raw.width / previous.value.width - 1) < 0.15));
    if (still) {
      this.skinTarget = null;
      this.anatomicalAnchor = { x: previous.value.x, y: previous.value.y };
      this.scaleStep = 0; this.scaleMoveFrames = 0;
      this.pendingRoll = 0;
      this.heldAnchor = raw.imageStill ? null : textureAnchor;
      this.heldScale = raw.imageStill ? 1 : textureScale;
      this.heldAngle = raw.imageStill ? 0 : textureAngle;
      if (raw.imageStill) {
        this.turnCandidate = null; this.confirmedTurnUntil = 0;
        this.rollCandidate = null; this.rollAlignmentUntil = 0;
      }
      this.uncertainTurnFrames = 0; this.uncertainLocalFrames = 0; this.stableTurnFrames = 0;
      const value = { ...raw, x: previous.value.x, y: previous.value.y,
        width: previous.value.width, orientation: previous.value.orientation.clone(),
        fingerLength: previous.value.fingerLength, surfaceFacing: previous.value.surfaceFacing };
      this.state = { raw, value, time, angularStep: raw.imageStill ? new Vector3() : angularStep, localStep: { x: 0, y: 0 } };
      return value;
    }
    if (this.heldAnchor && textureAnchor) carried = textureAnchor;
    const carriedAngle = imageMotion ? textureAngle : motion?.angle ?? 0;
    this.pendingRoll = 0;
    this.heldAnchor = null; this.heldScale = 1; this.heldAngle = 0;
    const previousRaw = motion ? motion.map(previous.raw) : previous.raw;
    const localStep = { x: raw.x - previousRaw.x, y: raw.y - previousRaw.y };
    const stepLength = Math.hypot(localStep.x, localStep.y);
    const previousStepLength = Math.hypot(previous.localStep.x, previous.localStep.y);
    const agreement = stepLength > 0.35 && previousStepLength > 0.35
      ? (localStep.x * previous.localStep.x + localStep.y * previous.localStep.y) / (stepLength * previousStepLength) : 0;
    const error = Math.hypot(raw.x - carried.x, raw.y - carried.y);
    this.uncertainLocalFrames = agreement > 0.7 ? this.uncertainLocalFrames + 1 : 0;
    // A single large joint correction can occur while the observed skin moves
    // by only a pixel. Confirm its direction before recentering the model or
    // its longitudinal bone anchor; neither path may bypass stabilization.
    const transientJointShift = imageMotion !== null && stepLength > raw.width * 0.05
      && this.uncertainLocalFrames < 2 && !pitched;
    // Follow sustained finger motion relative to the palm quickly, while
    // keeping alternating landmark jitter on the slow correction path.
    const localHz = imageMotion ? error > raw.width * 0.2 ? 8 : 1.2
      : reliable && error < raw.width * 0.06 && this.uncertainLocalFrames < 2 && this.palmMoveFrames < 2 ? 0.8
      : weakEdges ? error > raw.width * 0.2 ? 25 : this.uncertainLocalFrames >= 3 ? 12 : 0.8
      : error > raw.width * 0.15 ? 25 : agreement > 0.6 ? 16 : reliable ? 2.8 : 16;
    // Width confidence cannot validate landmark depth or attachment motion.
    // While skin tracks the same shape, preserve that attachment instead of
    // continually pulling it toward small, drifting landmark corrections.
    const skinAttachment = imageMotion !== null && time >= this.refitUntil && error < raw.width * 0.1;
    // The projected skin patch changes shape during a real pitch/turn. Its
    // similarity map can carry an old attachment sideways after straightening.
    // Reconcile a confirmed turn with the anatomical attachment gradually;
    // uncertain landmark flicker must not release a stationary skin hold.
    const attachmentBlend = recenterAttachment ? alpha(4, dt)
      : skinAttachment || (texturePoseHold && error < raw.width * 0.08) ? 0 : alpha(localHz, dt);
    const localBlend = textureDropout || transientJointShift ? Math.min(attachmentBlend, alpha(textureDropout ? 0.45 : 0.8, dt)) : attachmentBlend;
    const localCorrection = { x: (raw.x - carried.x) * localBlend, y: (raw.y - carried.y) * localBlend };
    const correctionLength = Math.hypot(localCorrection.x, localCorrection.y);
    const correctionBudget = Math.max(1.5, raw.width * 0.02);
    if (imageMotion && !pitched && correctionLength > correctionBudget) {
      localCorrection.x *= correctionBudget / correctionLength;
      localCorrection.y *= correctionBudget / correctionLength;
    }
    let x = carried.x + localCorrection.x;
    let y = carried.y + localCorrection.y;
    if (imageMotion) {
      // Keep the unsmoothed skin trajectory separately. Smoothing incremental
      // flow itself loses slow motion; smoothing its accumulated target removes
      // subpixel matching noise without discarding real displacement.
      this.skinTarget = { x, y };
      const displacement = Math.hypot(x - previous.value.x, y - previous.value.y);
      // The texture already measures this frame's movement. Extra interpolation
      // trails a fast hand and its reversal; reserve it for small matching noise.
      const blend = textureMotion > Math.max(3, raw.width * 0.08) ? 1
        : alpha(1.5 + 16 * MathUtils.smoothstep(displacement / Math.max(1, raw.width), 0.015, 0.08), dt);
      x = MathUtils.lerp(previous.value.x, x, blend);
      y = MathUtils.lerp(previous.value.y, y, blend);
    } else this.skinTarget = null;
    if (refitted && imageMotion && (raw.edgeConfidence ?? 0) >= 0.78 && raw.fingerSegment) {
      // A confirmed contour correction changes the physical across-finger
      // attachment even while skin is stationary. Apply that accepted lateral
      // correction to the carried trajectory; keep longitudinal joint noise on
      // its existing filter so refitting cannot make the ring climb the finger.
      const dx = raw.fingerSegment.tip.x - raw.fingerSegment.base.x;
      const dy = raw.fingerSegment.tip.y - raw.fingerSegment.base.y;
      const length = Math.hypot(dx, dy);
      if (length > 2) {
        const nx = -dy / length, ny = dx / length;
        const correct = (point: ScreenPoint) => {
          const across = (raw.x - point.x) * nx + (raw.y - point.y) * ny;
          return { x: point.x + nx * across, y: point.y + ny * across };
        };
        const corrected = correct({ x, y });
        x = corrected.x; y = corrected.y;
        if (this.skinTarget) this.skinTarget = correct(this.skinTarget);
      }
    }
    // A bounded sub-pixel hold removes stationary shimmer, without waiting
    // for a large movement threshold before following a slow-moving hand.
    if (!imageMotion && Math.hypot(x - previous.value.x, y - previous.value.y) < 0.45) {
      x = previous.value.x; y = previous.value.y;
    }
    if (raw.fingerSegment) {
      // Palm/skin similarity cannot model the nonuniform shortening of a
      // finger during yaw. Bound its longitudinal error against the observed
      // attachment after smoothing, and also remove it from accumulated flow
      // so it cannot return when the hand straightens. Lateral skin tracking
      // remains independent. Verified still pixels return above this block.
      const dx = raw.fingerSegment.tip.x - raw.fingerSegment.base.x;
      const dy = raw.fingerSegment.tip.y - raw.fingerSegment.base.y;
      const length = Math.hypot(dx, dy);
      if (length > 2) {
        const ax = dx / length, ay = dy / length;
        const turning = shapeChanged || confirmedTurn || time < this.attachmentRecenterUntil;
        const tolerance = Math.max(0.35, raw.width * (turning ? 0.008 : 0.015));
        const fraction = raw.fingerSegment.fraction ?? 0.53;
        const observed = { x: raw.fingerSegment.base.x + dx * fraction, y: raw.fingerSegment.base.y + dy * fraction };
        // Carry the attachment with the stabilized trajectory. Applying a hard
        // constraint to raw joints here would undo the position filter above.
        const anchor = this.anatomicalAnchor ?? previous.value;
        const transported = { x: anchor.x + x - previous.value.x, y: anchor.y + y - previous.value.y };
        const coherentTurn = rawTurn > 0.003 && directionAgreement > 0.7;
        const follow = !textureDropout && !transientJointShift && (coherentTurn || confirmedTurn || pitched || this.uncertainLocalFrames >= 2
          || this.palmMoveFrames >= 2 || Math.hypot(observed.x - transported.x, observed.y - transported.y) > raw.width * 0.15);
        const blend = alpha(follow ? 12 : textureDropout ? 0.45 : 0.8, dt);
        const target = { x: MathUtils.lerp(transported.x, observed.x, blend), y: MathUtils.lerp(transported.y, observed.y, blend) };
        this.anatomicalAnchor = target;
        const boneTurn = coherentTurn && ((rawTurn > 0.06
          && Math.abs(raw.fingerLength / Math.max(1, previous.raw.fingerLength * (imageMotion?.scale ?? 1)) - 1) > 0.025)
          || (rawTurn > 0.04 && this.uncertainTurnFrames >= 2));
        // Confirmed small pose changes must not release a stored joint error
        // in one step. Limit corrections relative to observed skin; a clear
        // bend/shortening can still carry the attachment promptly.
        const correctionLimit = textureDropout || (imageMotion && !pitched && !boneTurn) ? correctionBudget : Infinity;
        const constrain = (point: ScreenPoint) => {
          const error = (target.x - point.x) * ax + (target.y - point.y) * ay;
          const correction = Math.sign(error) * Math.min(correctionLimit, Math.max(0, Math.abs(error) - tolerance));
          return { x: point.x + ax * correction, y: point.y + ay * correction };
        };
        const attached = constrain({ x, y });
        x = attached.x; y = attached.y;
        if (this.skinTarget) this.skinTarget = constrain(this.skinTarget);
      }
    }
    // Good surface tracking owns the attachment while contour/joint evidence
    // is weak. The anatomical recenter and bone constraint above must not each
    // inject their own pixel-sized correction into that same camera frame.
    // Keep a small drift-correction allowance; release for genuine loss,
    // refitting, large bends or a substantially displaced attachment.
    if (imageMotion && weakEdges && time >= this.refitUntil && !gapRecovered
      && (raw.imageMotion?.after.length ?? 0) >= 6
      && imageMotion.residual < Math.max(.8, raw.width * .025)
      && error < raw.width * .2 && !pitched) {
      const surface = imageMotion.map(previous.value);
      const dx = x - surface.x, dy = y - surface.y, distance = Math.hypot(dx, dy);
      const budget = Math.max(.2, raw.width * .004);
      if (distance > budget) { x = surface.x + dx * budget / distance; y = surface.y + dy * budget / distance; }
      this.skinTarget = { x, y };
      this.anatomicalAnchor = { x, y };
    }
    const carriedOrientation = previous.value.orientation.clone();
    if (reliable) {
      const blend = imageMotion ? alpha(1.2 + 10 * MathUtils.smoothstep(Math.abs(carriedAngle), 0.008, 0.06), dt)
        : weakEdges ? alpha(1.25, dt) : 1;
      const roll = carriedAngle * blend;
      carriedOrientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -roll));
      if (imageMotion) this.pendingRoll = carriedAngle - roll;
    }
    if (alignRoll) {
      // Correct a persistent attachment-axis bias gently. Pure skin transport
      // otherwise preserves a slightly wrong initial roll indefinitely.
      const axis = projectedFingerAxis(carriedOrientation);
      const error = Math.atan2(fingerAxis.y, fingerAxis.x) - Math.atan2(axis.y, axis.x);
      carriedOrientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1),
        -Math.atan2(Math.sin(error), Math.cos(error)) * alpha(0.8, dt)));
      this.pendingRoll = 0;
    }
    const targetOrientation = raw.orientation.clone();
    if (skinAttachment) {
      // Skin motion owns screen-plane roll as well as position. Noisy palm
      // landmarks must not reintroduce roll after the texture has stabilized it.
      // Keep the measured out-of-plane pitch/twist so real tilts still follow.
      const targetAxis = projectedFingerAxis(targetOrientation);
      const carriedAxis = projectedFingerAxis(carriedOrientation);
      const difference = Math.atan2(targetAxis.y, targetAxis.x) - Math.atan2(carriedAxis.y, carriedAxis.x);
      targetOrientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), difference));
    }
    const angularError = carriedOrientation.angleTo(targetOrientation);
    // Alternating depth noise used to trigger the fast-turn path every frame.
    // Require directionally consistent rotation, or a persistent new pose,
    // before releasing strong smoothing around the finger's depth axes.
    this.uncertainTurnFrames = rawTurn > 0.015 && directionAgreement > 0.7 ? this.uncertainTurnFrames + 1 : 0;
    this.stableTurnFrames = rawTurn < 0.018 ? this.stableTurnFrames + 1 : 0;
    const poseEvidence = (palmMotion?.residual ?? 0) > raw.width * 0.008
      || Math.abs(raw.fingerLength / Math.max(1, previous.raw.fingerLength) - 1) > 0.025
      || Math.abs(motion?.angle ?? 0) > 0.02;
    // A real turn can move skin before it crosses the broad landmark-shape
    // release threshold. Two agreeing depth steps, observed skin movement or
    // foreshortening, and a small shape change establish it sooner. Model-only drift,
    // alternating depth noise and image-confirmed stillness cannot use this.
    const observedTurn = skeletalTurn || (!raw.imagePoseStable && raw.imageStill !== true
      && this.uncertainTurnFrames >= 1 && directionAgreement > 0.8
      && imageMotion !== null && (raw.imageMotion?.after.length ?? 0) >= 6
      && (textureMotion > Math.max(.65, raw.width * .012) || (skinDeformation ?? 0) > .006)
      && imageMotion.residual < Math.max(.8, raw.width * .03)
      && (time < this.turnFollowUntil || (shapeMotion !== null && (shapeMotion.residual > raw.width * .005
        || Math.abs(raw.fingerLength / Math.max(1, reference.length * shapeMotion.scale) - 1) > .004
        || Math.abs(Math.atan2(Math.sin(axisDifference), Math.cos(axisDifference))) > .015))));
    // Keep a validated turn responsive as it returns through the reference
    // angle. Its shape momentarily matches the reference there; that must not
    // relock a turn whose skin and angular movement are still being observed.
    if (observedTurn) this.turnFollowUntil = time + 180;
    const settlingTurn = !raw.imagePoseStable && raw.imageStill !== true && time < this.turnFollowUntil;
    const moving = observedTurn || settlingTurn || (weakEdges
      ? (poseEvidence && ((this.uncertainTurnFrames >= 3 && angularError > 0.08) || angularError > 0.35))
        || (this.stableTurnFrames >= 4 && angularError > 0.08)
      : (rawTurn > 0.018 && directionAgreement > 0.35) || (angularError > 0.18 && rawTurn < 0.018));
    const holdDepth = raw.imagePoseStable || angularError < (settlingTurn ? .006 : .025) || (!confirmedTurn && !observedTurn && !settlingTurn && (texturePoseHold || (weakEdges && !poseEvidence && !moving && angularError < 0.2)));
    const orientation = holdDepth ? carriedOrientation : weakEdges && !moving
      ? carriedOrientation.rotateTowards(targetOrientation, Math.min(angularError * alpha(confirmedTurn ? 3 : 0.65, dt), dt * (confirmedTurn ? 1.5 : 0.35)))
      : carriedOrientation.slerp(targetOrientation, alpha(moving ? 13 : 0.9, dt));
    // Keep the image-space finger direction consistent with the rendered pose.
    const rawAxis = projectedFingerAxis(raw.orientation);
    const stableAxis = projectedFingerAxis(orientation);
    const axisError = Math.atan2(rawAxis.y, rawAxis.x) - Math.atan2(stableAxis.y, stableAxis.x);
    const correction = Math.atan2(Math.sin(axisError), Math.cos(axisError));
    if (!raw.imagePoseStable && !texturePoseHold && !skinAttachment) orientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -correction * alpha(moving ? 18 : weakEdges ? 1 : 4, dt)));
    // A yaw foreshortens the palm similarity fit, but must not shrink a real
    // ring. Size comes only from the multi-bone distance estimate. Hold tiny
    // detector fluctuations and respond quickly to actual camera-distance
    // changes, without repeatedly transporting noisy scale ratios.
    const widthError = Math.abs(raw.width / Math.max(previous.value.width, 1) - 1);
    const scaleStep = Math.log(raw.width / Math.max(previous.raw.width, 1));
    this.scaleMoveFrames = Math.abs(scaleStep) > 0.001 && scaleStep * this.scaleStep > 0 ? this.scaleMoveFrames + 1 : 0;
    this.scaleStep = scaleStep;
    const scaleHz = time < this.refitUntil ? 3 : observedZoom ? 12 : widthError > 0.06 ? 18 : this.scaleMoveFrames >= 2 ? 6 : 0.8;
    const desiredWidth = widthError < (observedZoom ? 0.002 : weakEdges && time >= this.refitUntil ? 0.025 : 0.01)
      ? previous.value.width
      : MathUtils.lerp(previous.value.width, raw.width, alpha(scaleHz, dt));
    // Refit can correct a badly stalled size by much more than 50%. Bound
    // that visual transition in relative units, including on slow phones.
    const width = time < this.refitUntil
      ? MathUtils.clamp(desiredWidth, previous.value.width * Math.exp(-1.8 * dt), previous.value.width * Math.exp(1.8 * dt))
      : desiredWidth;
    if (time < this.refitUntil && Math.abs(raw.width / width - 1) > 0.01) this.refitUntil = Math.max(this.refitUntil, time + 160);
    const value = { ...raw, x, y, width, orientation, surfaceFacing: Math.abs(new Vector3(0, 0, 1).applyQuaternion(orientation).z) };
    this.state = { raw, value, time, angularStep, localStep };
    return value;
  }
}

// Fit a 2D affine map to a fixed, nearly front-facing palm reference.
// Its largest singular value follows image magnification while allowing the
// other axis to shorten during a turn. No predicted metric bone length enters
// this estimate, and a fixed reference avoids accumulating frame-to-frame drift.
function palmAffineFit(reference: ScreenPoint[], current: ScreenPoint[]) {
  if (reference.length < 4 || current.length !== reference.length
    || [...reference, ...current].some(p => !Number.isFinite(p.x + p.y))) return null;
  const center = (points: ScreenPoint[]) => points.reduce((sum, p) => ({
    x: sum.x + p.x / points.length, y: sum.y + p.y / points.length,
  }), { x: 0, y: 0 });
  const p = center(reference), q = center(current);
  let xx = 0, xy = 0, yy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
  for (let i = 0; i < reference.length; i++) {
    const x = reference[i].x - p.x, y = reference[i].y - p.y;
    const u = current[i].x - q.x, v = current[i].y - q.y;
    xx += x * x; xy += x * y; yy += y * y;
    ux += u * x; uy += u * y; vx += v * x; vy += v * y;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant < 1e-4 * (xx + yy) ** 2) return null;
  const a = (ux * yy - uy * xy) / determinant, b = (uy * xx - ux * xy) / determinant;
  const c = (vx * yy - vy * xy) / determinant, d = (vy * xx - vx * xy) / determinant;
  const trace = a * a + b * b + c * c + d * d;
  const scale = Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * (a * d - b * c) ** 2))) / 2);
  // Keep the signed stretch before taking its largest eigenvalue. Alternating
  // landmark shear has alternating off-diagonal terms, but its largest
  // singular value is always positive; averaging that scalar invents a zoom.
  // sqrt(A' A) removes screen roll while preserving those opposing errors.
  const area = Math.abs(a * d - b * c);
  const stretchDenominator = Math.sqrt(trace + 2 * area);
  const stretch = { xx: (a * a + c * c + area) / stretchDenominator,
    xy: (a * b + c * d) / stretchDenominator, yy: (b * b + d * d + area) / stretchDenominator };
  let error = 0;
  for (let i = 0; i < reference.length; i++) {
    const x = reference[i].x - p.x, y = reference[i].y - p.y;
    error += (q.x + a * x + b * y - current[i].x) ** 2 + (q.y + c * x + d * y - current[i].y) ** 2;
  }
  const relativeError = Math.sqrt(error / (xx + yy)) / Math.max(scale, 1e-6);
  return scale > 0.25 && scale < 4
    ? { scale, relativeError, stretch, referenceSupport: determinant / (xx + yy) ** 2 } : null;
}

export function palmImageScale(reference: ScreenPoint[], current: ScreenPoint[]) {
  const fit = palmAffineFit(reference, current);
  return fit && fit.relativeError < 0.035 ? fit.scale : null;
}

export function skinScaleEvidence(before: ScreenPoint[], after: ScreenPoint[]) {
  const affine = palmAffineFit(before, after);
  // A narrow line of skin matches cannot distinguish camera zoom from
  // foreshortening along the finger. It can still carry position, but both
  // image axes need independent spatial support before changing ring diameter.
  if (!affine || affine.relativeError > 0.08 || affine.referenceSupport < 0.01) return undefined;
  const { xx, xy, yy } = affine.stretch;
  const difference = Math.hypot(xx - yy, 2 * xy);
  const smaller = (xx + yy - difference) / 2, larger = (xx + yy + difference) / 2;
  // A turn deforms skin mainly along one image axis. It may carry the ring's
  // position, but cannot establish camera zoom. Only near-isotropic magnification
  // enters the distance estimate; similarity scale avoids largest-axis noise bias.
  if (!(smaller > 0) || larger / smaller > 1.08) return undefined;
  const motion = fitPalmMotion(before, after);
  return motion && motion.scale >= 0.8 && motion.scale <= 1.25 ? motion.scale : undefined;
}

// A pitch can foreshorten the skin without translating its center. Measure
// differential stretch only when the observed features span both image axes.
// Uniform camera zoom, screen rotation and translation contribute no evidence.
export function skinAnisotropy(before: ScreenPoint[], after: ScreenPoint[]) {
  const affine = palmAffineFit(before, after);
  if (!affine || affine.relativeError > .035 || affine.referenceSupport < .01) return undefined;
  const { xx, xy, yy } = affine.stretch;
  const difference = Math.hypot(xx - yy, 2 * xy);
  return difference / Math.max(1e-6, (xx + yy) * .5);
}

class PalmScaleLock {
  private reference: ScreenPoint[] | null = null;
  private referenceScale = 0;
  private scale = 1;
  private observations: { xx: number; xy: number; yy: number }[] = [];
  private skinScale: number | null = null;
  private skinTime = -Infinity;
  private frontalMetrics: number[] = [];
  private scaleCandidate: { value: number; frames: number } | null = null;
  private source: 'palm' | 'skin' | 'still' | 'held' | 'conflict' | 'contour' = 'palm';
  private contourCandidate: { target: number; direction: number; frames: number } | null = null;
  private contourUntil = -Infinity;
  private contourTime = -Infinity;
  get diagnostics() { return { source: this.source, scale: this.referenceScale * this.scale }; }
  reset() { this.reference = null; this.referenceScale = 0; this.scale = 1; this.observations = [];
    this.skinScale = null; this.skinTime = -Infinity; this.frontalMetrics = []; this.scaleCandidate = null; this.source = 'palm';
    this.contourCandidate = null; this.contourUntil = -Infinity; this.contourTime = -Infinity; }
  reproject(map: (point: ScreenPoint) => ScreenPoint, scale: number) {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.reference = this.reference?.map(map) ?? null;
    this.referenceScale *= scale;
    this.frontalMetrics = this.frontalMetrics.map(value => value * scale);
    this.observations = [];
    this.scaleCandidate = null;
    this.contourCandidate = null;this.contourUntil = -Infinity;
  }
  rebase(anchors: ScreenPoint[], scale: number, preserveFrontalReference = false, metricScale?: number) {
    this.scaleCandidate = null;
    this.contourCandidate = null;this.contourUntil = -Infinity;
    // A confirmed silhouette may repair distance while the hand is tilted.
    // Keep the frontal geometry in that case: treating a narrowed palm as a
    // new frontal reference makes the ring grow when the hand turns back.
    if (preserveFrontalReference && this.reference) {
      // Correct the distance actually in use. Recomputing a raw affine fit
      // here bypassed the quality gate/median and made the next frame jump
      // when update() returned to its previously accepted scale.
      this.referenceScale = scale / this.scale; this.observations = []; this.skinScale = this.scale;
      return true;
    }
    if (preserveFrontalReference) return false;
    this.reference = anchors.map(p => ({ ...p }));
    this.referenceScale = scale; this.scale = 1; this.observations = []; this.skinScale = null;
    if (metricScale !== undefined) this.frontalMetrics = [metricScale];
    return true;
  }
  update(anchors: ScreenPoint[], initialScale: number, canInitialize: boolean, motion?: FingerMotionEvidence, contourDistance?: number) {
    if (!this.reference) {
      if (!canInitialize || palmImageScale(anchors, anchors) === null) return null;
      this.reference = anchors.map(p => ({ ...p }));
      this.referenceScale = initialScale;
    }
    this.source = 'palm';
    // Texture matching may see too little skin magnification and report still
    // pixels during a camera-distance change. A stable contour plus uniform
    // palm growth/shrinkage is independent evidence of that distance. Require
    // agreement across several frames, then follow smoothly instead of
    // waiting for the old 5% recovery steps to snap the diameter into place.
    if (motion) {
      const elapsed = MathUtils.clamp((motion.time - this.contourTime) / 1000, .001, .12);
      this.contourTime = motion.time;
      const projection = palmAffineFit(this.reference!, anchors);
      const stretch = projection?.stretch;
      const spread = stretch ? Math.hypot(stretch.xx - stretch.yy, 2 * stretch.xy) : Infinity;
      const isotropic = stretch && spread / Math.max(1e-6, stretch.xx + stretch.yy) < .035;
      const target = contourDistance && contourDistance / this.referenceScale;
      const agrees = canInitialize && target && target > .25 && target < 4 && projection
        && projection.relativeError < .02 && isotropic && Math.abs(projection.scale / target - 1) < .035;
      if (agrees) {
        const difference = target / this.scale - 1;
        const palmChange = projection.scale / this.scale - 1;
        const previous = this.contourCandidate;
        if (Math.abs(difference) > .01 && Math.abs(palmChange) > .006 && difference * palmChange > 0) {
          const consistent = previous && previous.direction === Math.sign(difference) && Math.abs(target / previous.target - 1) < .08;
          this.contourCandidate = { target, direction: Math.sign(difference), frames: consistent ? previous.frames + 1 : 1 };
          if (this.contourCandidate.frames >= 3) this.contourUntil = motion.time + 240;
        }
        if (motion.time < this.contourUntil && Math.abs(difference) > .004) {
          this.scale = Math.exp(MathUtils.lerp(Math.log(this.scale), Math.log(target), alpha(6, elapsed)));
          this.skinScale = this.scale; this.skinTime = motion.time;
          this.observations = []; this.scaleCandidate = null; this.source = 'contour';
          return this.referenceScale * this.scale;
        }
      } else this.contourCandidate = null;
    }
    if (motion && canInitialize) {
      this.frontalMetrics.push(initialScale);
      if (this.frontalMetrics.length > 5) this.frontalMetrics.shift();
    }
    if (motion?.still) {
      // The fixed pixels validate the accepted distance, not earlier noisy
      // incremental scale samples. Freeze the physical fit as well as the
      // visible pose, and start the next real movement from that same distance.
      this.skinScale = this.scale; this.skinTime = motion.time;
      this.observations = []; this.scaleCandidate = null; this.source = 'still';
      return this.referenceScale * this.scale;
    }
    let affine = palmAffineFit(this.reference, anchors);
    if (anchors.length === 5 && this.reference.length === 5 && (!affine || affine.relativeError > 0.003)) {
      // A background boundary can pull one wrist/knuckle landmark sideways.
      // Four agreeing, non-collinear anchors still define the palm projection.
      // Exclude one point only when it removes most of the fitting error;
      // ordinary multi-joint noise continues through temporal confirmation.
      let inlierFit: ReturnType<typeof palmAffineFit> = null;
      for (let omit = 0; omit < 5; omit++) {
        const fit = palmAffineFit(this.reference.filter((_, i) => i !== omit), anchors.filter((_, i) => i !== omit));
        // Four knuckles can lie almost on one line after excluding the wrist.
        // Their shallow arch then magnifies tiny shape changes into a large
        // affine stretch, even with an excellent residual. Require support
        // along both reference axes before a quartet can replace the palm.
        if (fit && fit.referenceSupport >= 0.015 && fit.relativeError < 0.008
          && (!inlierFit || fit.relativeError < inlierFit.relativeError)) inlierFit = fit;
      }
      if (inlierFit && (!affine || inlierFit.relativeError < affine.relativeError * 0.25)) affine = inlierFit;
    }
    let measured = affine && affine.relativeError < 0.035 ? affine.scale : null;
    let stretch = measured !== null ? affine!.stretch : null;
    if (anchors.length === this.reference.length) {
      // Real palms deform and cease to fit one plane. Do not freeze the last
      // camera distance indefinitely: use agreement among long palm spans.
      const spans: { ratio: number; i: number; j: number }[] = [];
      const extent = Math.max(...this.reference.map(p => Math.hypot(p.x - this.reference![0].x, p.y - this.reference![0].y)));
      for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
        const before = Math.hypot(this.reference[j].x - this.reference[i].x, this.reference[j].y - this.reference[i].y);
        const after = Math.hypot(anchors[j].x - anchors[i].x, anchors[j].y - anchors[i].y);
        if (before > extent * 0.55 && Number.isFinite(after)) spans.push({ ratio: after / before, i, j });
      }
      spans.sort((a, b) => b.ratio - a.ratio);
      const supported = spans.filter(p => spans[0].ratio / p.ratio < 1.08);
      // Several spans sharing one displaced wrist are not independent evidence.
      const independent = supported.some(a => supported.some(b =>
        a.i !== b.i && a.i !== b.j && a.j !== b.i && a.j !== b.j));
      if (measured === null && supported.length >= 3 && independent) {
        const candidate = median(supported.map(p => p.ratio));
        if (candidate > 0.25 && candidate < 4) {
          measured = candidate;
          stretch = { xx: candidate, xy: 0, yy: candidate };
        }
      }
    }
    const skinMotion = motion?.frontal && motion.scale !== undefined && Number.isFinite(motion.scale)
      && motion.scale >= 0.8 && motion.scale <= 1.25;
    if (skinMotion) {
      // On a frontal finger the tracked skin supplies image magnification.
      // Palm joints can stretch while the actual finger stays the same size;
      // accumulating the fixed-reference skin ratios avoids those false zooms.
      this.skinScale ??= this.scale;
      this.skinScale *= motion.scale!;
      this.skinTime = motion.time;
      measured = this.skinScale;
      stretch = { xx: measured, xy: 0, yy: measured };
      this.source = 'skin';
      if (affine && affine.relativeError < 0.015 && Math.abs(affine.scale / this.scale - 1) < 0.01
        && Math.abs(measured / this.scale - 1) > 0.015) {
        // Small patch-fit scale errors can accumulate during translation. A
        // frontal, unchanged palm contradicts that zoom. Preserve the accepted
        // diameter; real magnification changes both image measurements.
        this.skinScale = this.scale; measured = this.scale;
        stretch = { xx: measured, xy: 0, yy: measured }; this.source = 'conflict';
      }
    } else if (motion?.frontal && this.skinScale !== null && motion.time - this.skinTime <= 180) {
      measured = this.skinScale;
      stretch = { xx: measured, xy: 0, yy: measured };
      this.source = 'held';
    } else {
      this.skinScale = null;
      // Curling changes the palm's shape. A large inferred enlargement opposed
      // by the independent metric palm estimate is not a confirmed camera zoom.
      // Hold the physical fit until clear edges or agreeing distance evidence.
      if (motion && measured !== null && measured / this.scale > 1.08
        && this.frontalMetrics.length > 0 && initialScale / median(this.frontalMetrics) < 0.95) {
        measured = null; stretch = null; this.source = 'conflict';
      }
    }
    const supportedSkinZoom = skinMotion && measured !== null && affine && affine.relativeError < 0.035
      && Math.abs(affine.scale / measured - 1) < 0.02 && Math.abs(measured / this.scale - 1) > 0.003
      && Math.abs(affine.scale / this.scale - 1) > 0.003
      && (affine.scale - this.scale) * (measured - this.scale) > 0;
    const palmStretch = affine?.stretch;
    const palmSpread = palmStretch ? Math.hypot(palmStretch.xx - palmStretch.yy, 2 * palmStretch.xy) : Infinity;
    const isotropicPalm = palmStretch && palmSpread / Math.max(1e-6, palmStretch.xx + palmStretch.yy) < 0.025;
    const supportedPalmZoom = skinMotion && affine && affine.relativeError < 0.015 && isotropicPalm
      && Math.abs(affine.scale / this.scale - 1) > 0.003 && Math.abs(motion.scale! - 1) > 0.0015
      && (affine.scale - this.scale) * (motion.scale! - 1) > 0;
    const zoomTarget = supportedPalmZoom ? affine!.scale : measured;
    if ((supportedSkinZoom || supportedPalmZoom) && zoomTarget !== null) {
      const previousCandidate = this.scaleCandidate;
      const frames = previousCandidate && (previousCandidate.value - this.scale) * (zoomTarget - this.scale) > 0
        ? previousCandidate.frames + 1 : 1;
      this.scaleCandidate = { value: zoomTarget, frames };
      if (frames >= 2) {
        // Two independent image measurements agree: skin magnification and a
        // fixed-reference palm. Avoid stacking the palm window and render
        // deadbands behind a gradual zoom; alternating texture noise has no vote.
        // An isotropic palm supplies absolute magnification when small-patch
        // resampling underestimates the incremental skin scale.
        this.scale *= MathUtils.clamp(zoomTarget / this.scale, 0.8, 1.2);
        this.skinScale = zoomTarget;
        this.observations = []; this.scaleCandidate = null;
        return this.referenceScale * this.scale;
      }
    } else this.scaleCandidate = null;
    if (measured !== null && stretch) {
      this.observations.push(stretch);
      if (this.observations.length > 5) this.observations.shift();
      // Discard either extreme independently, then average the signed stretch.
      // One bad palm frame still has no vote, and alternating single-joint
      // errors cancel instead of repeatedly inflating the locked diameter.
      if (this.observations.length === 5) {
        const robustMean = (key: 'xx' | 'xy' | 'yy') => {
          const values = this.observations.map(p => p[key]).sort((a, b) => a - b);
          return (values[1] + values[2] + values[3]) / 3;
        };
        const xx = robustMean('xx'), xy = robustMean('xy'), yy = robustMean('yy');
        const target = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2;
        if (Math.abs(target / this.scale - 1) > 0.025) {
          // Confirmation already spans several inference frames. A small
          // per-frame limit afterward made real zoom take seconds on iPad.
          this.scale *= MathUtils.clamp(target / this.scale, 0.8, 1.2);
        }
      }
    } else this.observations = [];
    return this.referenceScale * this.scale;
  }
}

export class FingerFitFilter {
  private distance = new PalmScaleLock();
  private ratio: number | null = null;
  private width = 0;
  private candidateRatio = 0;
  private candidateOffset = 0;
  private candidateFrames = 0;
  private offset = 0;
  private revision = -1;
  private candidateRevision = -Infinity;
  private recovery: { last: number; frames: number; samples: { ratio: number; offset: number; time: number; support: number }[] } | null = null;
  private fitRevision = 0;
  private evidenceStatus: 'waiting' | 'uncertain' | 'side view' | 'confirming' | 'accepted' = 'waiting';
  get status() { return this.evidenceStatus; }
  get confirmationFrames() { return Math.min(3, this.candidateFrames); }
  get calibrated() { return this.ratio !== null; }
  get diagnostics() { return { recoveryFrames: this.recovery?.frames ?? 0, fitRevision: this.fitRevision,
    status: this.evidenceStatus, distance: this.distance.diagnostics }; }
  // A resized object-cover viewport changes pixel units, not finger size.
  // Transform the distance reference and preserve the accepted physical fit.
  reproject(map: (point: ScreenPoint) => ScreenPoint, scale: number) {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.distance.reproject(map, scale);
    this.width *= scale;
  }
  reset() {
    this.distance.reset();
    this.recovery = null;
    this.fitRevision = 0;
    this.ratio = null; this.width = 0; this.candidateRatio = 0; this.candidateOffset = 0;
    this.candidateFrames = 0; this.offset = 0; this.revision = -1;
    this.candidateRevision = -Infinity; this.evidenceStatus = 'waiting';
  }
  update(handScale: number, facing: number, edge?: { width: number; offset: number; revision: number; confidence: number; support?: number }, anchors?: ScreenPoint[], centeringProjection = 1, motion?: FingerMotionEvidence) {
    if (!(handScale > 0) || !Number.isFinite(handScale)) return null;
    const metricScale = handScale;
    // Centering belongs to the finger's anatomical across-axis. Its screen
    // projection reverses between palm and dorsal views and shortens on a turn.
    // Retaining a screen-space offset moved the ring to the wrong side after
    // turning the hand, especially while image edges were temporarily unclear.
    const projection = Number.isFinite(centeringProjection) ? MathUtils.clamp(centeringProjection, -1, 1) : 1;
    const canCenter = Math.abs(projection) >= 0.65;
    // Surface facing also falls during forward pitch, even though the entire
    // across-finger diameter remains visible. Use its actual image projection
    // to distinguish that case from a sideways view of the ring.
    const forwardCrossSection = motion !== undefined && facing >= 0.25 && Math.abs(projection) >= 0.9;
    const canObserveFit = facing >= 0.65 || forwardCrossSection;
    if (anchors) {
      const contourDistance = this.ratio !== null && edge && canCenter && facing >= .9
        && edge.confidence >= .76 && (edge.support ?? 0) >= 4
        && Math.abs(edge.offset) < edge.width * .25 ? edge.width / this.ratio : undefined;
      const distance = this.distance.update(anchors, handScale, facing >= 0.9
        && !!edge && edge.confidence >= MIN_FINGER_EDGE_CONFIDENCE, motion, contourDistance);
      if (distance === null) { this.evidenceStatus = 'side view'; return null; }
      handScale = distance;
    }
    // A locked physical fit still needs to follow camera distance. If the
    // palm estimate has stalled, repeated stable edge observations repair
    // distance at moderate tilts too. Four-section fits need longer support;
    // ambiguous scans and alternating widths cannot change it.
    const disagreement = this.ratio === null || !edge ? 0 : edge.width / (this.ratio * handScale);
    const widthDisagrees = Math.abs(disagreement - 1) > 0.05;
    const centeringDisagrees = !!edge && this.ratio !== null
      && Math.abs(edge.offset - this.offset * handScale * projection) > edge.width * 0.05;
    const centeredEvidence = edge && (Math.abs(edge.offset - this.offset * handScale * projection) < edge.width * 0.15
      // A frontal six-boundary fit can correct a changed landmark bias after
      // turning the hand. The old joint center is not the measured skin center.
      || (edge.support === 6 && edge.confidence >= 0.78 && (facing >= 0.9 || forwardCrossSection)
        && Math.abs(edge.offset) < edge.width * 0.25));
    const canRecover = motion?.still !== true && anchors && this.ratio !== null && edge && canObserveFit && canCenter
      && edge.confidence >= (edge.support === 6 ? MIN_FINGER_EDGE_CONFIDENCE : 0.78)
      && ((edge.support ?? 0) >= 4 || edge.support === 3
        && (facing >= 0.9 && motion?.frontal || forwardCrossSection && Math.abs(projection) >= 0.94))
      && centeredEvidence
      && disagreement > 0.4 && disagreement < 2.5 && (widthDisagrees || centeringDisagrees);
    if (!canRecover) {
      // One ambiguous scan must not discard every preceding clear scan.
      // Pause briefly; never count the ambiguous observation as evidence.
      if (!edge || !anchors || !canObserveFit || !widthDisagrees && !centeringDisagrees
        || !this.recovery || edge.revision - this.recovery.last > 1800) this.recovery = null;
    }
    else if (edge.revision !== this.revision) {
      const prior = this.recovery;
      // Recovery counts distinct clear inference frames just like initial
      // fitting. Keep enough history for cautious partial fits at low FPS;
      // an ambiguous scan pauses evidence and never contributes an inlier.
      const recent = prior && edge.revision > prior.last && edge.revision - prior.last <= 1800
        ? prior.samples.filter(p => edge.revision - p.time <= 10000) : [];
      recent.push({ ratio: edge.width / handScale, offset: edge.offset / (handScale * projection), time: edge.revision, support: edge.support ?? 0 });
      if (recent.length > 16) recent.shift();
      // Compare widths in distance-relative units. A single 4% deviation used
      // to restart confirmation forever, even with mostly clear boundaries.
      // Require a robust majority of a short window; ambiguous scans add no votes.
      const centerRatio = median(recent.map(p => p.ratio));
      const centerOffset = median(recent.map(p => p.offset));
      const inliers = recent.filter(p => Math.abs(p.ratio / centerRatio - 1) < 0.08
        && Math.abs(p.offset - centerOffset) < centerRatio * 0.08);
      this.recovery = { last: edge.revision, frames: inliers.length, samples: recent };
      const complete = inliers.every(p => p.support === 6);
      const partial = inliers.some(p => p.support <= 4);
      const cautious = facing < 0.85 && !forwardCrossSection || disagreement > 1.8 || disagreement < 0.55;
      const requiredFrames = cautious ? partial ? 10 : 6 : partial ? 6 : complete ? 3 : 4;
      const requiredMs = cautious ? 350 : partial ? 300 : 160;
      if (inliers.length >= requiredFrames && inliers.length >= recent.length * 0.75
        && edge.revision - inliers[0].time >= requiredMs) {
        const confirmedWidthChange = Math.abs(centerRatio / this.ratio! - 1) > 0.05;
        const recoveredScale = confirmedWidthChange ? centerRatio * handScale / this.ratio! : handScale;
        // A confirmed, flat six-boundary view can also repair a deformed palm
        // reference. Keep the frontal reference through actual tilts; replacing
        // it with a narrowed side view would make the returning hand grow again.
        const flatReference = motion?.frontal && facing >= 0.985 && edge.support === 6 && edge.confidence >= 0.78;
        if (!confirmedWidthChange || this.distance.rebase(anchors, recoveredScale, !flatReference, metricScale)) {
          const recoveredOffset = median(inliers.map(p => p.offset)) * handScale;
          handScale = recoveredScale;
          this.offset = recoveredOffset / handScale;
          this.fitRevision++;
        }
        this.recovery = null;
      }
    }
    if (edge && edge.revision !== this.revision) {
      const elapsed = MathUtils.clamp((edge.revision - this.revision) / 1000, 0.001, 0.1);
      this.revision = edge.revision;
      const ratio = edge.width / handScale;
      const trustworthy = canCenter && Number.isFinite(edge.confidence) && edge.confidence >= MIN_FINGER_EDGE_CONFIDENCE
        && Number.isFinite(edge.revision) && ratio > 0.1 && ratio < 1.2
        && Math.abs(edge.offset) < edge.width * 0.3
        && (this.ratio === null || Math.abs(edge.width / (this.ratio * handScale) - 1) < 0.15);
      if (!trustworthy || (this.ratio === null && anchors ? facing < 0.9 : !canObserveFit)) {
        this.candidateFrames = 0;
        this.evidenceStatus = trustworthy ? 'side view' : 'uncertain';
      } else {
        // Confirm distinct, nearby observations in hand-relative units so
        // approaching the camera does not look like a change of finger shape.
        // These are distinct inference frames, not video frames. Slow iPad
        // inference must still accumulate three trustworthy observations;
        // ambiguous edges and genuine tracking gaps restart confirmation.
        const consistent = edge.revision > this.candidateRevision && edge.revision - this.candidateRevision <= 1200
          && Math.abs(ratio / Math.max(this.candidateRatio, 1e-6) - 1) < 0.05
          && Math.abs(edge.offset / (handScale * projection) - this.candidateOffset) < ratio * 0.1;
        this.candidateFrames = consistent ? this.candidateFrames + 1 : 1;
        this.candidateRatio = ratio;
        this.candidateOffset = edge.offset / (handScale * projection);
        this.candidateRevision = edge.revision;
        this.evidenceStatus = this.candidateFrames >= 3 ? 'accepted' : 'confirming';
        if (this.candidateFrames >= 3) {
          if (this.ratio === null) {
            this.width = edge.width;
            this.offset = edge.offset / (handScale * projection);
            this.ratio = this.width / handScale;
          }
          // Finger size stays locked until explicit refitting. Later edges
          // can refine centering, but may not change the calibrated diameter.
          if (!(canRecover && centeringDisagrees)
            && Math.abs(this.offset * handScale * projection - edge.offset) > edge.width * 0.02) {
            this.offset = MathUtils.lerp(this.offset, edge.offset / (handScale * projection), alpha(2, elapsed));
          }
        }
      }
    }
    // Uncertain/missing edges cannot change the calibrated centering or width.
    // Their screen projection still follows the hand's pose and camera distance.
    if (this.ratio === null) return null;
    this.width = this.ratio * handScale;
    return { width: this.width, offset: this.offset * handScale * projection, revision: this.fitRevision,
      scaleObserved: this.distance.diagnostics.source === 'contour' };
  }
}
