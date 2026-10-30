import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, CylinderGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3, OrthographicCamera } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HandIdentityTracker } from '../src/hand-identity.ts';
import { detectionSize, solveRingPose, projectedFingerAxis, RingPoseFilter, FingerFitFilter, RingSurfaceConstraint } from '../src/ring-tracking.ts';

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
// A metric left hand with its dorsal side facing the camera (index on the
// right of the image). Values are
// camera-space metres; screen landmarks are independently projected below.
const joints = Array.from({ length: 21 }, () => [0, 0, 0]);
joints[0] = [0, -0.055, 0];
joints[5] = [0.035, 0.005, 0];
joints[9] = [0.012, 0.013, 0];
joints[10] = [0.013, 0.055, 0];
joints[13] = [-0.01, 0.009, 0];
joints[14] = [-0.012, 0.05, 0];
joints[17] = [-0.032, 0, 0];
joints[18] = [-0.04, 0.034, 0];
function sample({ pitch = 0, yaw = 0, roll = 0, mirror = false, pixelsPerMeter = 2000, tx = 420, ty = 650, left = false } = {}) {
  const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'ZYX'));
  const world = joints.map(p => new Vector3(p[0] * (left ? -1 : 1), p[1], p[2]).applyQuaternion(q));
  const screen = world.map(p => ({ x: tx + p.x * pixelsPerMeter * (mirror ? -1 : 1), y: ty - p.y * pixelsPerMeter }));
  const landmarks = world.map(p => ({ x: (tx + p.x * pixelsPerMeter) / 900, y: (ty - p.y * pixelsPerMeter) / 1600, z: -p.z, worldX: p.x, worldY: -p.y, worldZ: -p.z }));
  return { landmarks, screen, pose: solveRingPose(landmarks, screen, left ? 'Right' : 'Left', mirror) };
}
function placement(s) {
  assert.ok(s.pose);
  return {
    x: s.screen[13].x * 0.47 + s.screen[14].x * 0.53,
    y: s.screen[13].y * 0.47 + s.screen[14].y * 0.53,
    width: s.pose.handScale * 0.4,
    orientation: s.pose.orientation,
    anchors: s.pose.anchors,
    surfaceFacing: s.pose.facing,
    fingerLength: s.pose.fingerLength,
    handScale: s.pose.handScale,
    fingerSegment: { base: s.screen[13], tip: s.screen[14] },
  };
}

test('verified stationary pixels reject the captured tripod depth jitter and release for a real turn', async () => {
  const captures = JSON.parse(await readFile(new URL('./fixtures/tripod-depth-jitter.json', import.meta.url), 'utf8'));
  for (const capture of captures) {
    const base = { ...placement(sample()), ...capture.rendered,
      orientation: new Quaternion().fromArray(capture.rendered.orientation).normalize(), fitRevision: 1, imageStill: true };
    const filter = new RingPoseFilter();
    filter.update(base, 0);
    let value;
    for (let i = 0; i < capture.trace.length; i++) {
      const row = capture.trace[i];
      value = filter.update({ ...base, x: row[1], y: row[2], width: row[3],
        orientation: new Quaternion().fromArray(row.slice(12, 16)).normalize(),
        // Even false landmark shape changes must not override unchanged pixels.
        anchors: base.anchors.map((p, j) => ({ x: p.x + (j % 2 ? 5 : -5) * (i % 2 ? 1 : -1), y: p.y })) }, (i + 1) * 90);
      near(value.orientation.angleTo(base.orientation), 0, 1e-6);
      near(value.x, base.x); near(value.y, base.y); near(value.width, base.width);
    }
    const turned = base.orientation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4));
    for (let i = 1; i <= 10; i++) value = filter.update({ ...base, orientation: turned, imageStill: false }, (capture.trace.length + i) * 90);
    assert.ok(value.orientation.angleTo(turned) < 0.03, 'actual image movement must release depth tracking');
  }
});

test('portrait and landscape inference retain the full frame and aspect ratio', () => {
  assert.deepEqual(detectionSize(1080, 1920), { width: 360, height: 640 });
  assert.deepEqual(detectionSize(1920, 1080), { width: 640, height: 360 });
});

test('slow camera frames preserve a verified still pose and release for actual movement', () => {
  const base = placement(sample());
  const filter = new RingPoseFilter(); filter.update(base, 0);
  for (let i = 1; i <= 20; i++) {
    const sign = i % 2 ? 1 : -1;
    const noisy = placement(sample({ tx: 420 + sign * 3, ty: 650 + sign * 2,
      yaw: sign * 0.12, pixelsPerMeter: 2000 + sign * 80 }));
    const value = filter.update({ ...noisy, imageStill: true }, i * 500);
    near(value.x, base.x); near(value.y, base.y); near(value.width, base.width);
    near(value.orientation.angleTo(base.orientation), 0, 1e-6);
  }
  const moved = placement(sample({ tx: 490, ty: 710, yaw: 0.4, pixelsPerMeter: 2600 }));
  let value;
  for (let i = 21; i <= 27; i++) value = filter.update({ ...moved, imageStill: false }, i * 500);
  assert.ok(Math.hypot(value.x - moved.x, value.y - moved.y) < 1);
  assert.ok(value.orientation.angleTo(moved.orientation) < 0.03);
  assert.ok(Math.abs(value.width / moved.width - 1) < 0.015);
});

test('a verified still image survives a long render stall without copying noisy detector pose', () => {
  const base = placement(sample()), filter = new RingPoseFilter();
  filter.update(base, 0);
  const noisy = placement(sample({ tx: 427, ty: 654, yaw: 0.15, pixelsPerMeter: 2100 }));
  const held = filter.update({ ...noisy, imageStill: true }, 1700);
  near(held.x, base.x); near(held.y, base.y); near(held.width, base.width);
  near(held.orientation.angleTo(base.orientation), 0, 1e-6);
  const moved = placement(sample({ tx: 540, ty: 750, yaw: 0.5, pixelsPerMeter: 2800 }));
  const released = filter.update({ ...moved, imageStill: false }, 3400);
  near(released.x, moved.x); near(released.y, moved.y); near(released.width, moved.width);
  near(released.orientation.angleTo(moved.orientation), 0, 1e-6);
  assert.equal(filter.update(null, 5100), null, 'missing hands still reset stale attachment');
});

test('unconfirmed joint and width noise does not bypass position or scale smoothing', () => {
  for (const edgeConfidence of [0.5, 0.95]) {
    const base = { ...placement(sample()), edgeConfidence };
    const filter = new RingPoseFilter(); filter.update(base, 0);
    let positionEnergy = 0, scaleEnergy = 0, rotationEnergy = 0;
    for (let i = 1; i <= 120; i++) {
      const sign = i % 2 ? 1 : -1;
      const noisy = { ...base, y: base.y + sign * 2, width: base.width * (1 + sign * 0.035),
        fingerSegment: { base: { ...base.fingerSegment.base, y: base.fingerSegment.base.y + sign * 2 },
          tip: { ...base.fingerSegment.tip, y: base.fingerSegment.tip.y + sign * 2 } },
        orientation: base.orientation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sign * 0.09)) };
      const value = filter.update(noisy, i * 33);
      positionEnergy += (value.y - base.y) ** 2;
      scaleEnergy += (value.width / base.width - 1) ** 2;
      rotationEnergy += value.orientation.angleTo(base.orientation) ** 2;
    }
    assert.ok(Math.sqrt(positionEnergy / 120) < 0.65, `stationary joint jitter: ${Math.sqrt(positionEnergy / 120)}px`);
    assert.ok(Math.sqrt(scaleEnergy / 120) < 0.006, `stationary width pulses: ${Math.sqrt(scaleEnergy / 120)}`);
    assert.ok(Math.sqrt(rotationEnergy / 120) < 0.015, `stationary rotation flicker: ${Math.sqrt(rotationEnergy / 120)}rad`);
  }
});

test('gradual real camera-distance changes release scale smoothing', () => {
  const filter = new RingPoseFilter();
  for (let i = 0; i <= 80; i++) {
    const raw = { ...placement(sample({ pixelsPerMeter: 2000 * (1 + i * 0.005) })), edgeConfidence: 0.9 };
    const value = filter.update(raw, i * 33);
    assert.ok(Math.abs(value.width / raw.width - 1) < 0.025, `real zoom lags at frame ${i}`);
  }
});

test('both hands and both camera modes keep the band axis on the observed finger', () => {
  for (const left of [false, true]) for (const mirror of [false, true]) {
    for (const yaw of [-1.15, -0.6, 0, 0.6, 1.15, Math.PI]) {
      const s = sample({ left, mirror, yaw, roll: 0.7, pitch: 0.3 });
      assert.ok(s.pose);
      const axis = projectedFingerAxis(s.pose.orientation);
      const x = s.screen[14].x - s.screen[13].x, y = s.screen[14].y - s.screen[13].y;
      near(axis.x, x / Math.hypot(x, y)); near(axis.y, y / Math.hypot(x, y));
    }
  }
});

test('the setting follows a sideways turn and is on the far side of an open palm', () => {
  for (const mirror of [false, true]) {
    const front = sample({ mirror }).pose;
    const side = sample({ mirror, yaw: 1.15 }).pose;
    const palm = sample({ mirror, yaw: Math.PI, pitch: 0.28 }).pose;
    const stone = p => new Vector3(0, 0, -1).applyQuaternion(p.orientation);
    assert.ok(stone(front).z > 0.99);
    assert.ok(Math.abs(stone(side).x) > 0.8);
    assert.ok(stone(palm).z < -0.95);
    // A clear palm should present a narrow rear profile, not an open U.
    assert.ok(Math.abs(new Vector3(0, 1, 0).applyQuaternion(palm.orientation).z) < 0.07);
  }
});

test('continuous rotation crosses edge-on without a half-turn sign flip', () => {
  let previous;
  for (let yaw = 0; yaw <= Math.PI * 2; yaw += 0.025) {
    const pose = sample({ yaw }).pose;
    assert.ok(pose);
    if (previous) assert.ok(previous.angleTo(pose.orientation) < 0.12);
    previous = pose.orientation;
  }
});

test('ring diameter stays constant on tilt and responds to camera distance', () => {
  for (const pitch of [-0.8, 0, 0.8]) for (const yaw of [-1, 0, 1]) {
    const scale = sample({ pitch, yaw }).pose.handScale;
    near(scale, 100);
    near(sample({ pitch, yaw, pixelsPerMeter: 3000 }).pose.handScale / scale, 1.5);
  }
  const fit = new FingerFitFilter();
  let calibrated;
  for (const revision of [-80, -40, 0]) calibrated = fit.update(100, 1, { width: 40, offset: 0, revision, confidence: 1 });
  near(calibrated.width, 40);
  near(fit.update(150, 0.2).width, 60);
  near(fit.update(150, 0.2, { width: 18, offset: 0, revision: 2, confidence: 1 }).width, 60);
});

test('fast translation and reversal stay with the finger on the first frame', () => {
  const filter = new RingPoseFilter();
  filter.update(placement(sample()), 0);
  const moved = placement(sample({ tx: 120, ty: 1250 }));
  const result = filter.update(moved, 33);
  near(result.x, moved.x); near(result.y, moved.y);
  const reverse = placement(sample({ tx: 620, ty: 350 }));
  const returned = filter.update(reverse, 66);
  near(returned.x, reverse.x); near(returned.y, reverse.y);
});

test('filtering a turn cannot shrink the ring with the foreshortened palm', () => {
  const filter = new RingPoseFilter();
  for (let i = 0; i < 80; i++) {
    const raw = placement(sample({ yaw: i * 0.018 }));
    const result = filter.update(raw, i * 16.667);
    near(result.width, 40, 0.05);
  }
});

test('small continuous movement does not wait for a large distance threshold', () => {
  const filter = new RingPoseFilter();
  for (let i = 0; i < 60; i++) {
    const raw = placement(sample({ tx: 420 + i * 0.75 }));
    const result = filter.update(raw, i * 16.667);
    // Landmark-only motion needs two agreeing frames before releasing the hold.
    assert.ok(Math.hypot(result.x - raw.x, result.y - raw.y) <= 1.50001);
  }
});

test('scale noise is held while a real distance change responds immediately', () => {
  const filter = new RingPoseFilter();
  const initial = placement(sample()); filter.update(initial, 0);
  for (let i = 1; i < 20; i++) {
    const noisy = placement(sample({ pixelsPerMeter: 2000 + (i % 2 ? 12 : -12) }));
    near(filter.update(noisy, i * 33).width, initial.width);
  }
  const closer = placement(sample({ pixelsPerMeter: 3000 }));
  assert.ok(filter.update(closer, 660).width > closer.width * 0.97);
});

test('new palm edges cannot silently replace an established fit', () => {
  const fit = new FingerFitFilter();
  for (const revision of [-80, -40, 0]) fit.update(100, 1, { width: 40, offset: 0, revision, confidence: 1 });
  for (let revision = 40; revision < 1000; revision += 40) {
    near(fit.update(100, 0.95, { width: 56, offset: 0, revision, confidence: 1 }).width, 40);
  }
});

test('a single bad edge measurement cannot resize the ring', () => {
  const fit = new FingerFitFilter();
  for (const revision of [-80, -40, 0]) fit.update(100, 1, { width: 40, offset: 0, revision, confidence: 1 });
  near(fit.update(100, 1, { width: 58, offset: 0, revision: 2, confidence: 1 }).width, 40);
  near(fit.update(100, 1, { width: 40, offset: 0, revision: 3, confidence: 1 }).width, 40);
});

test('stationary ring-point noise is suppressed while palm landmarks remain fixed', () => {
  const filter = new RingPoseFilter();
  const raw = placement(sample());
  filter.update(raw, 0);
  let energy = 0;
  for (let i = 1; i <= 120; i++) {
    const noisy = { ...raw, x: raw.x + (i % 2 ? 2 : -2), y: raw.y + (i % 2 ? -2 : 2) };
    const result = filter.update(noisy, i * 16.667);
    energy += (result.x - raw.x) ** 2 + (result.y - raw.y) ** 2;
  }
  assert.ok(Math.sqrt(energy / 120) < 0.8);
});

test('alternating depth estimates do not repeatedly release the fast rotation filter', () => {
  const filter = new RingPoseFilter();
  const initial = placement(sample()); filter.update(initial, 0);
  let maximum = 0;
  for (let i = 1; i <= 120; i++) {
    const noisy = placement(sample({ yaw: i % 2 ? 0.065 : -0.065 }));
    const value = filter.update(noisy, i * 16.667);
    maximum = Math.max(maximum, value.orientation.angleTo(initial.orientation));
  }
  assert.ok(maximum < 0.02, `angular shimmer ${maximum} radians`);
});

test('a sustained real rotation follows promptly after its first frame', () => {
  const filter = new RingPoseFilter();
  for (let i = 0; i < 40; i++) {
    const raw = placement(sample({ yaw: i * 0.035 }));
    const value = filter.update(raw, i * 16.667);
    assert.ok(value.orientation.angleTo(raw.orientation) < 0.05);
  }
});

test('loss and reacquisition do not animate from an old location', () => {
  const filter = new RingPoseFilter();
  filter.update(placement(sample()), 0);
  assert.ok(filter.update(null, 30));
  assert.equal(filter.update(null, 60), null);
  const moved = placement(sample({ tx: 600, ty: 1100 }));
  const reacquired = filter.update(moved, 180);
  near(reacquired.x, moved.x); near(reacquired.y, moved.y);
});

test('a brief missed detection hides stale jewelry without discarding its stabilized skin attachment', () => {
  const filter = new RingPoseFilter(), base = placement(sample());
  filter.update(base, 0);
  const stable = filter.update({ ...base, imageStill: true }, 33);
  assert.equal(filter.update(null, 100), null, 'do not leave stale jewelry visible while the hand is missing');
  assert.ok(filter.current(), 'retain the fit internally through a short detector miss');
  const noisy = { ...base, x: base.x + 4, y: base.y - 3, width: base.width * 1.04,
    orientation: base.orientation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .12)), imageStill: false };
  const recovered = filter.update(noisy, 166);
  assert.ok(Math.hypot(recovered.x - stable.x, recovered.y - stable.y) < 1.5, 'do not jump to re-detection joint noise before skin tracking warms up');
  assert.ok(Math.abs(recovered.width / stable.width - 1) < .01, 'do not pulse the diameter on reacquisition');
  assert.ok(recovered.orientation.angleTo(stable.orientation) < .02, 'do not snap to a new noisy normal');
  assert.equal(filter.update(null, 500), null);
  assert.equal(filter.current(), undefined, 'a longer hand loss must release the old attachment');
});

test('the overlay does not add stone parallax when translated to a corner', () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 4; camera.updateMatrixWorld();
  const a = new Vector3(0, 0, 0.2).project(camera);
  const b = new Vector3(0.8, -0.8, 0.2).project(camera);
  near(b.x - a.x, 0.8); near(b.y - a.y, -0.8);
});

test('LR1844 palm view hides its stone behind the finger and retains a thin rear band', async () => {
  const bytes = await readFile(new URL('./fixtures/LR1844.glb', import.meta.url));
  const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const group = new Group(); group.add(asset.scene);
  const bounds = new Box3().setFromObject(group);
  const center = bounds.getCenter(new Vector3());
  asset.scene.position.x -= center.x; asset.scene.position.y -= center.y;
  group.updateMatrixWorld(true);
  const diameter = bounds.getSize(new Vector3()).x * 0.797;
  const palm = sample({ yaw: Math.PI, pitch: 0.28 }).pose;
  group.quaternion.copy(palm.orientation);
  const mask = new Mesh(new CylinderGeometry(diameter * 0.5, diameter * 0.5, diameter * 1.35, 64), new MeshBasicMaterial());
  mask.quaternion.copy(palm.orientation);
  mask.updateMatrixWorld(true); group.updateMatrixWorld(true);
  const ray = new Raycaster();
  const visible = [];
  let visibleGems = 0;
  for (let ix = -35; ix <= 35; ix++) for (let iy = -14; iy <= 14; iy++) {
    const x = ix / 60 * diameter, y = iy / 60 * diameter;
    ray.set(new Vector3(x, y, 5), new Vector3(0, 0, -1));
    const ringHit = ray.intersectObject(group, true)[0];
    const fingerHit = ray.intersectObject(mask, false)[0];
    if (ringHit && (!fingerHit || ringHit.distance < fingerHit.distance)) {
      visible.push({ x, y });
      if (/gem|diamond|stone/i.test(ringHit.object.name)) visibleGems++;
    }
  }
  assert.ok(visible.length > 20, 'rear band must remain visible');
  assert.equal(visibleGems, 0, 'the palm must occlude every visible stone sample');
  const spanX = Math.max(...visible.map(p => p.x)) - Math.min(...visible.map(p => p.x));
  const spanY = Math.max(...visible.map(p => p.y)) - Math.min(...visible.map(p => p.y));
  assert.ok(spanX >= diameter * 0.95, 'band must reach both finger edges');
  assert.ok(spanY < diameter * 0.25, `rear band too deep: ${spanY / diameter}`);
  mask.geometry.dispose(); mask.material.dispose();
  group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } });
});

test('initial calibration sits on the measured center immediately', () => {
  const fit = new FingerFitFilter();
  let result;
  for (const revision of [0, 40, 80]) result = fit.update(100, 1, { width: 40, offset: 6, revision, confidence: 1 });
  near(result.offset, 6);
  // A sudden one-frame edge-center jump must not pull a fitted ring sideways.
  near(fit.update(100, 1, { width: 40, offset: -6, revision: 120, confidence: 1 }).offset, 6);
});

test('sustained finger motion follows promptly even when the palm stays still', () => {
  const filter = new RingPoseFilter();
  const raw = placement(sample());
  filter.update(raw, 0);
  for (let i = 1; i <= 30; i++) {
    const moved = { ...raw, x: raw.x + i * 1.5 };
    const result = filter.update(moved, i * 16.667);
    assert.ok(Math.abs(result.x - moved.x) < (i === 1 ? 1.6 : 1.3), `finger lag: ${result.x - moved.x}`);
  }
});

test('rejected optical flow falls back to valid palm motion', () => {
  const filter = new RingPoseFilter();
  filter.update(placement(sample()), 0);
  const raw = placement(sample({ tx: 423 }));
  raw.imageMotion = {
    before: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    after: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }],
  };
  const result = filter.update(raw, 33);
  near(result.x, raw.x); near(result.y, raw.y);
});

test('a strongly pitched hand uses the remaining reliable palm span for scale', () => {
  const s = sample({ pitch: 1.4 });
  near(s.pose.handScale, 100);
  near(sample({ pitch: 1.4, pixelsPerMeter: 3000 }).pose.handScale, 150);
});

function lockedFit() {
  const filter = new FingerFitFilter();
  const anchors = sample().pose.anchors;
  for (const revision of [0, 40, 80]) filter.update(100, 1, { width: 40, offset: 0, revision, confidence: 1 }, anchors);
  return filter;
}

test('metric hand-size noise and repeated edge corrections cannot pump a stationary ring', () => {
  const filter = lockedFit();
  const anchors = sample().pose.anchors;
  for (let i = 0; i < 300; i++) {
    const result = filter.update(60 + (i % 7) * 20, 1,
      { width: i % 2 ? 48 : 33, offset: 0, revision: 120 + i * 33, confidence: 1 }, anchors);
    near(result.width, 40);
  }
});

test('image distance stays fixed through palm turns without relying on world bone size', () => {
  const filter = lockedFit();
  for (let i = 0; i <= 120; i++) {
    const s = sample({ yaw: i * Math.PI / 120, pitch: 0.2, roll: 0.7, tx: 500, ty: 400 });
    const result = filter.update(i % 2 ? 60 : 160, s.pose.facing, undefined, s.pose.anchors);
    near(result.width, 40);
  }
});

test('a real camera-distance change resizes the locked fit in both directions', () => {
  const filter = lockedFit();
  for (const factor of [1.5, 0.65, 1]) {
    let result;
    const anchors = sample({ pixelsPerMeter: 2000 * factor, yaw: 0.9 }).pose.anchors;
    for (let i = 0; i < 30; i++) result = filter.update(100, 0.6, undefined, anchors);
    assert.ok(Math.abs(result.width / (40 * factor) - 1) <= 0.026, `distance scale ${result.width}`);
  }
});

test('small image-size noise and one bad palm frame cannot resize the ring', () => {
  const filter = lockedFit();
  for (let i = 0; i < 60; i++) {
    const factor = i === 30 ? 1.8 : i % 2 ? 1.015 : 0.985;
    near(filter.update(100, 1, undefined, sample({ pixelsPerMeter: 2000 * factor }).pose.anchors).width, 40);
  }
});

test('alternating single-joint palm shear cannot magnify a stationary calibrated ring', () => {
  for (const joint of [0, 1]) {
    const fit = lockedFit(), anchors = sample().pose.anchors;
    for (let i = 0; i < 90; i++) {
      const noisy = anchors.map((p, j) => ({ x: p.x + (j === joint ? (i % 2 ? 8 : -8) : 0), y: p.y }));
      near(fit.update(100, 1, undefined, noisy).width, 40);
    }
  }
});

test('a persistently displaced palm joint cannot invent a camera zoom while four anchors agree', () => {
  for (const joint of [0, 1, 2]) for (const shift of [-12, 12]) {
    const fit = lockedFit(), anchors = sample().pose.anchors;
    const displaced = anchors.map((p, j) => ({ x: p.x + (j === joint ? shift : 0), y: p.y }));
    for (let i = 0; i < 40; i++) near(fit.update(100, 1, undefined, displaced).width, 40);
  }
});

test('coherent camera magnification settles within six inference frames in both directions', () => {
  for (const factor of [0.65, 1.5]) {
    const fit = lockedFit(), anchors = sample({ pixelsPerMeter: 2000 * factor, yaw: 0.6 }).pose.anchors;
    let value;
    for (let i = 0; i < 6; i++) value = fit.update(100, 0.8, undefined, anchors);
    assert.ok(Math.abs(value.width / (40 * factor) - 1) < 0.03, `camera distance ${factor}: ${value.width}px`);
  }
});

test('viewport reprojection preserves calibrated width and offset without waiting for new edges', () => {
  const fit = lockedFit(), anchors = sample({ pixelsPerMeter: 2600, yaw: 0.6 }).pose.anchors;
  let previous;
  for (let i = 0; i < 12; i++) previous = fit.update(100, 0.8, undefined, anchors);
  const map = p => ({ x: p.x * 1.5 + 60, y: p.y * 1.5 - 30 });
  fit.reproject(map, 1.5);
  assert.equal(fit.calibrated, true);
  for (let i = 0; i < 10; i++) {
    const value = fit.update(100, 0.8, undefined, anchors.map(map));
    near(value.width, previous.width * 1.5);
    near(value.offset, previous.offset * 1.5);
    assert.equal(value.revision, previous.revision);
  }
});

test('refitting clears the distance reference and accepts a new finger width', () => {
  const filter = lockedFit(); filter.reset();
  const anchors = sample({ pixelsPerMeter: 3000 }).pose.anchors;
  let result;
  for (const revision of [0, 40, 80]) result = filter.update(150, 1, { width: 75, offset: 0, revision, confidence: 1 }, anchors);
  near(result.width, 75);
});

test('initial image reference waits for a front-facing hand', () => {
  const filter = new FingerFitFilter();
  const anchors = sample({ yaw: 1.2 }).pose.anchors;
  for (const revision of [0, 40, 80]) {
    assert.equal(filter.update(100, 0.4, { width: 40, offset: 0, revision, confidence: 1 }, anchors), null);
  }
  assert.equal(filter.calibrated, false);
});

test('a deformed palm fit holds size instead of inventing a camera-distance change', () => {
  const filter = lockedFit();
  const anchors = sample().pose.anchors.map((p, i) => ({ x: p.x + (i === 2 ? 100 : 0), y: p.y }));
  for (let i = 0; i < 30; i++) near(filter.update(200, 1, undefined, anchors).width, 40);
});

test('a frontal image bounds unsupported large depth estimates without forcing every tilt flat', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  for (const pitch of [-0.45, 0.45]) for (const yaw of [-0.7, 0.7]) {
    const noisy = sample({ pitch, yaw });
    // Only world depth is noisy; the actual image landmarks stay fixed.
    const pose = solveRingPose(noisy.landmarks, flat.screen, 'Left', false);
    const result = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, 40);
    const axis = new Vector3(0, 1, 0).applyQuaternion(result);
    const stone = new Vector3(0, 0, -1).applyQuaternion(result);
    assert.ok(Math.abs(axis.z) <= 0.350001);
    assert.ok(stone.z > 0.79, 'unsupported depth cannot produce a large side-on setting');
    assert.ok(Math.abs(stone.x) < 0.56);
  }
});

test('image-constrained surface turns continuously from back to palm', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  let previous;
  for (let yaw = 0; yaw < Math.PI + 0.01; yaw += 0.02) {
    const s = sample({ yaw });
    const result = constraint.update(s.pose.orientation, s.pose.anchors, s.pose.fingerLength, 40);
    if (previous) assert.ok(previous.angleTo(result) < 0.14);
    if (yaw > 3) assert.ok(new Vector3(0, 0, -1).applyQuaternion(result).z < -0.95);
    previous = result;
  }
});

test('true proximal foreshortening still permits ring pitch', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  const bent = sample({ pitch: -0.85 });
  const result = constraint.update(bent.pose.orientation, bent.pose.anchors, bent.pose.fingerLength, 40);
  const axis = new Vector3(0, 1, 0).applyQuaternion(result);
  assert.ok(axis.z < -0.6, 'a real pitch cannot be flattened');
  const projected = projectedFingerAxis(result);
  const expected = projectedFingerAxis(bent.pose.orientation);
  near(projected.x, expected.x); near(projected.y, expected.y);
});

test('switching hands resets the surface sign and keeps the setting dorsal in both camera modes', () => {
  for (const mirror of [false, true]) for (const yaw of [0, Math.PI]) {
    const identity = new HandIdentityTracker(), constraint = new RingSurfaceConstraint(), filter = new RingPoseFilter();
    let time = 0;
    for (const left of [false, true, false]) {
      const s = sample({ left, mirror, yaw });
      const label = left ? 'Right' : 'Left';
      for (let frame = 0; frame < 4; frame++) {
        const tracked = identity.update(label, 0.99, s.screen, time);
        if (tracked.reset) { constraint.reset(); filter.reset(); }
        if (tracked.handedness === label && !tracked.pending) {
          const pose = solveRingPose(s.landmarks, s.screen, tracked.handedness, mirror);
          const q = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, 40, true);
          const rendered = filter.update({ ...placement(s), orientation: q }, time);
          const stone = new Vector3(0, 0, -1).applyQuaternion(rendered.orientation);
          assert.ok(yaw === 0 ? stone.z > 0.99 : stone.z < -0.99,
            'the new hand must not inherit the previous hand\'s palm/back reference');
        }
        time += 100;
      }
    }
  }
});

test('complete stable finger edges recover a stalled distance estimate', () => {
  const filter = lockedFit();
  const anchors = sample().pose.anchors;
  for (let i = 0; i < 7; i++) {
    const result = filter.update(100, 1, { width: 60, offset: 0, revision: 120 + i * 40, confidence: 0.8, support: 6 }, anchors);
    near(result.width, i < 4 ? 40 : 60);
  }
  near(filter.update(100, 1, undefined, anchors).width, 60);
});

test('partial or inconsistent edges cannot recover distance', () => {
  for (const support of [3, 6]) {
    const filter = lockedFit();
    for (let i = 0; i < 30; i++) {
      const width = support === 3 ? 60 : i % 2 ? 60 : 52;
      near(filter.update(100, 1, { width, offset: 0, revision: 120 + i * 40, confidence: 0.8, support }, sample().pose.anchors).width, 40);
    }
  }
});

test('five clear sections automatically refit after sustained agreement', () => {
  const filter = lockedFit();
  let result;
  for (let i = 0; i < 10; i++) {
    result = filter.update(100, 0.88, { width: 50, offset: 0, revision: 120 + i * 40, confidence: 0.83, support: 5 }, sample().pose.anchors);
    near(result.width, i < 4 ? 40 : 50);
  }
  assert.equal(result.revision, 1);
});

test('slow frames and inconsistent patch-point noise do not move stationary skin', () => {
  const filter = new RingPoseFilter();
  const initial = placement(sample()); filter.update(initial, 0);
  const texture = [-20, 20].flatMap(y => [-20, 0, 20].map(x => ({ x: initial.x + x, y: initial.y + y })));
  for (let i = 1; i <= 12; i++) {
    const raw = { ...initial, x: initial.x + (i % 2 ? 4 : -4),
      imageMotion: { before: texture, after: texture.map((p, j) => ({ x: p.x + (j % 3 === 1 ? -0.8 : 0.4), y: p.y })) } };
    near(filter.update(raw, i * 200).x, initial.x);
  }
});

test('automatic refitting eases in even while skin stays stationary', () => {
  const filter = new RingPoseFilter();
  const initial = { ...placement(sample()), fitRevision: 0 }; filter.update(initial, 0);
  const texture = initial.anchors;
  const refit = { ...initial, width: 44, fitRevision: 1, imageMotion: { before: texture, after: texture } };
  const first = filter.update(refit, 33);
  assert.ok(first.width > 40 && first.width < 43);
  let value;
  for (let i = 2; i <= 14; i++) value = filter.update(refit, i * 33);
  near(value.width, 44, 0.5);
});

test('missing edges and skin flow cannot turn a stationary finger from world-pose wobble', () => {
  const filter = new RingPoseFilter();
  const initial = { ...placement(sample()), edgeConfidence: 0 };
  filter.update(initial, 0);
  for (let i = 1; i <= 48; i++) {
    const raw = { ...initial, x: initial.x + (i % 2 ? 3 : -3),
      orientation: sample({ yaw: 0.15 * Math.sin(i * Math.PI / 6) }).pose.orientation };
    const result = filter.update(raw, i * 75);
    assert.ok(result.orientation.angleTo(initial.orientation) < 0.02);
    assert.ok(Math.abs(result.x - initial.x) < 1.3);
  }
});

test('a clear sustained turn still moves the ring when silhouette edges are unavailable', () => {
  const filter = new RingPoseFilter();
  for (let i = 0; i < 24; i++) {
    const raw = { ...placement(sample({ yaw: 0.7 + i * 0.04 })), edgeConfidence: 0 };
    const result = filter.update(raw, i * 75);
    assert.ok(result.orientation.angleTo(raw.orientation) < 0.16, 'real turns must release the hold');
  }
});

test('coherent distance changes survive one shortened nonplanar palm joint', () => {
  for (const factor of [0.75, 1.35]) {
    const filter = lockedFit();
    const anchors = sample({ pixelsPerMeter: 2000 * factor }).pose.anchors.map((p, i) => ({
      x: p.x, y: p.y + (i === 2 ? 25 * factor : 0),
    }));
    let result;
    for (let i = 0; i < 30; i++) result = filter.update(100, 1, undefined, anchors);
    assert.ok(Math.abs(result.width / (40 * factor) - 1) < 0.026, `distance ${factor}: ${result.width}`);
  }
});

test('stationary skin holds landmark drift and releases for actual motion', () => {
  const filter = new RingPoseFilter();
  const initial = placement(sample());
  filter.update(initial, 0);
  const texture = [{ x: 400, y: 590 }, { x: 420, y: 590 }, { x: 410, y: 630 }];
  for (let i = 1; i <= 60; i++) {
    const drift = Math.sin(i / 10);
    const raw = { ...initial, x: initial.x + 4 * drift, width: initial.width * (1 + 0.08 * drift),
      orientation: sample({ yaw: i % 2 ? 0.12 : -0.12 }).pose.orientation,
      imageMotion: { before: texture, after: texture } };
    const result = filter.update(raw, i * 33);
    near(result.x, initial.x); near(result.width, initial.width);
    near(result.orientation.angleTo(initial.orientation), 0);
  }
  const moved = placement(sample({ tx: 423 }));
  moved.imageMotion = { before: texture, after: texture.map(p => ({ x: p.x + 3, y: p.y })) };
  near(filter.update(moved, 2013).x, moved.x, 0.7);
});

test('subpixel skin movement accumulates instead of freezing a slow hand', () => {
  const filter = new RingPoseFilter();
  filter.update(placement(sample()), 0);
  const texture = [{ x: 400, y: 590 }, { x: 420, y: 590 }, { x: 410, y: 630 }];
  for (let i = 1; i <= 50; i++) {
    const raw = placement(sample({ tx: 420 + 0.2 * i }));
    raw.imageMotion = { before: texture, after: texture.map(p => ({ x: p.x + 0.2, y: p.y })) };
    near(filter.update(raw, i * 33).x, raw.x, 0.85);
  }
});

test('small alternating texture shifts are damped without leaving a displaced attachment', () => {
  const initial = { ...placement(sample()), width: 110, edgeConfidence: 0.4 };
  const filter = new RingPoseFilter();
  filter.update(initial, 0);
  let previousShift = 0, squaredError = 0;
  for (let i = 1; i <= 40; i++) {
    const shift = i % 2 ? 1.4 : -1.4;
    const raw = { ...initial, x: initial.x + shift,
      imageMotion: { before: initial.anchors,
        after: initial.anchors.map(p => ({ x: p.x + shift - previousShift, y: p.y })) } };
    const value = filter.update(raw, i * 90);
    squaredError += (value.x - initial.x) ** 2;
    previousShift = shift;
  }
  assert.ok(Math.sqrt(squaredError / 40) < 0.8, 'reduce visible jitter from small skin matching fluctuations');
  for (let i = 41; i <= 50; i++) {
    const value = filter.update({ ...initial, imageMotion: { before: initial.anchors,
      after: initial.anchors.map(p => ({ x: p.x - previousShift, y: p.y })) } }, i * 90);
    previousShift = 0;
    assert.ok(Math.abs(value.x - initial.x) < 0.8, 'settle at the attachment after fluctuations stop');
  }
});

test('palm shortening alone cannot amplify a measured ring twist', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  const noisy = sample({ yaw: 0.65 });
  const pose = solveRingPose(noisy.landmarks, flat.screen, 'Left', false);
  for (const shortening of [0.2, 0.4, 0.6]) {
    const anchors = flat.pose.anchors.map((p, i) => i ? p : {
      x: p.x, y: p.y + (flat.pose.anchors[3].y - p.y) * shortening,
    });
    const result = constraint.update(pose.orientation, anchors, flat.pose.fingerLength, 40);
    assert.ok(result.angleTo(flat.pose.orientation) <= pose.orientation.angleTo(flat.pose.orientation) + 0.001);
  }
});

test('whole-palm foreshortening can confirm a turn when adjacent knuckle spread stays wide', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  const screen = flat.screen.map(p => ({ ...p }));
  screen[5].x += (screen[17].x - screen[5].x) * 0.16;
  const noisy = sample({ yaw: 0.8 });
  const pose = solveRingPose(noisy.landmarks, screen, 'Left', false);
  const result = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, 40);
  const stone = new Vector3(0, 0, -1).applyQuaternion(result);
  assert.ok(Math.abs(stone.x) > 0.3, 'a supported side turn must not be flattened');
  assert.ok(stone.z > 0, 'the stone stays on the back of the hand');
});

test('surface constraints are invariant to camera distance and clear on refit', () => {
  const constraint = new RingSurfaceConstraint();
  const flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  for (const factor of [0.7, 1.5]) {
    const s = sample({ pixelsPerMeter: 2000 * factor });
    near(constraint.update(s.pose.orientation, s.pose.anchors, s.pose.fingerLength, 40 * factor).angleTo(flat.pose.orientation), 0);
  }
  constraint.reset();
  const palm = sample({ yaw: Math.PI });
  const result = constraint.update(palm.pose.orientation, palm.pose.anchors, palm.pose.fingerLength, 40);
  assert.ok(new Vector3(0, 0, -1).applyQuaternion(result).z < -0.99);
});

test('a narrower knuckle span cannot amplify tiny depth sign changes into sideways swings', () => {
  const constraint = new RingSurfaceConstraint(), flat = sample();
  constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40);
  const screen = flat.screen.map(p => ({ ...p }));
  screen[9].x += (screen[17].x - screen[9].x) * 0.35;
  let previous;
  for (const yaw of [0.003, -0.003, 0.006, -0.006]) {
    const pose = solveRingPose(sample({ yaw }).landmarks, screen, 'Left', false);
    const result = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, 40);
    assert.ok(result.angleTo(flat.pose.orientation) < 0.02);
    if (previous) assert.ok(previous.angleTo(result) < 0.02);
    previous = result;
  }
});

test('clear edges do not let landmark depth drift override a tracked skin attachment', () => {
  const filter = new RingPoseFilter(), initial = { ...placement(sample()), edgeConfidence: 0.9 };
  filter.update(initial, 0);
  // Slight image translation deliberately exceeds the all-pose still gate.
  // The ring must move with the skin, without wandering relative to it.
  for (let i = 1; i <= 36; i++) {
    const skinX = i * 1.5;
    const raw = { ...initial, x: initial.x + skinX + 2.5 * Math.sin(i / 4),
      fingerSegment: { base: { x: initial.fingerSegment.base.x + skinX, y: initial.fingerSegment.base.y },
        tip: { x: initial.fingerSegment.tip.x + skinX, y: initial.fingerSegment.tip.y } },
      anchors: initial.anchors.map(p => ({ x: p.x + skinX, y: p.y })),
      orientation: sample({ yaw: i % 2 ? 0.4 : -0.4 }).pose.orientation,
      imageMotion: { before: initial.anchors, after: initial.anchors.map(p => ({ x: p.x + 1.5, y: p.y })) } };
    const value = filter.update(raw, i * 90);
    near(value.x, initial.x + skinX, 0.1);
    near(value.orientation.angleTo(initial.orientation), 0, 0.001);
  }
  const current = filter.current();
  const noFlow = { ...initial, ...current, imageMotion: undefined,
    orientation: sample({ yaw: 0.6 }).pose.orientation };
  near(filter.update(noFlow, 36 * 90 + 90).orientation.angleTo(current.orientation), 0, 0.001);
});

test('a slow observed turn releases the texture depth hold instead of freezing its original pose', () => {
  const filter = new RingPoseFilter();
  let previous = placement(sample());
  filter.update({ ...previous, edgeConfidence: 0.9 }, 0);
  for (let i = 1; i <= 70; i++) {
    const raw = { ...placement(sample({ yaw: i * 0.02 })), edgeConfidence: 0.9 };
    raw.imageMotion = { before: previous.anchors, after: raw.anchors };
    const value = filter.update(raw, i * 80);
    assert.ok(value.orientation.angleTo(raw.orientation) < 0.2, `turn lag at ${i}`);
    previous = raw;
  }
});

test('captured left and right tilts rotate the head even when skin tracking stays stationary', async () => {
  const captures = JSON.parse(await readFile(new URL('./fixtures/small-hand-tilts.json', import.meta.url), 'utf8'));
  for (const capture of captures) {
    const { width, height } = capture.viewport;
    const zoom = Math.max(width / capture.video.width, height / capture.video.height);
    const videoWidth = capture.video.width * zoom, videoHeight = capture.video.height * zoom;
    const screen = capture.hand.landmarks.map(p => ({
      x: (width - videoWidth) / 2 + p.x * videoWidth, y: (height - videoHeight) / 2 + p.y * videoHeight,
    }));
    const pose = solveRingPose(capture.hand.landmarks, screen, capture.hand.handedness, false);
    const constraint = new RingSurfaceConstraint();
    const target = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, capture.raw.width);
    const measuredStone = new Vector3(0, 0, -1).applyQuaternion(pose.orientation);
    const targetStone = new Vector3(0, 0, -1).applyQuaternion(target);
    assert.equal(Math.sign(targetStone.x), Math.sign(measuredStone.x));
    assert.ok(Math.abs(targetStone.x) > 0.3, `${capture.source}: must preserve the observed tilt`);
    const filter = new RingPoseFilter();
    const placement = { ...capture.raw, anchors: pose.anchors, surfaceFacing: pose.facing,
      edgeConfidence: capture.edgeConfidence, orientation: new Quaternion(...capture.raw.orientation) };
    filter.update(placement, 0);
    let value;
    for (let i = 1; i <= 16; i++) value = filter.update({ ...placement, orientation: target,
      imageMotion: { before: pose.anchors, after: pose.anchors } }, i * 85);
    assert.ok(value.orientation.angleTo(target) < 0.04, 'stationary texture must not lock the head camera-facing');
    const settled = value.orientation.clone();
    for (let i = 17; i <= 36; i++) {
      value = filter.update({ ...placement, x: placement.x + (i % 2 ? 2 : -2),
        orientation: target.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i % 2 ? 0.009 : -0.009)),
        imageMotion: { before: pose.anchors, after: pose.anchors } }, i * 85);
      near(value.x, placement.x, 0.05);
      assert.ok(value.orientation.angleTo(settled) < 0.025, 'a settled tilt must resist small depth fluctuations');
    }
  }
});

test('coherent landmark corrections cannot bypass skin-based position smoothing', () => {
  const initial = { ...placement(sample()), edgeConfidence: 0.9 };
  const filter = new RingPoseFilter();
  filter.update(initial, 0);
  let previous = initial;
  for (let i = 1; i <= 2; i++) {
    const value = filter.update({ ...initial, x: initial.x + i,
      // A noisy palm joint releases the shape hold; skin still has priority.
      anchors: initial.anchors.map((p, j) => ({ x: p.x + (j === 1 ? 8 * i : 0), y: p.y })),
      imageMotion: { before: initial.anchors, after: initial.anchors } }, i * 80);
    assert.ok(value.x - previous.x < 1, 'landmark agreement must not trigger fast skin-relative correction');
    previous = value;
  }
});

test('scale recovery at a moderate tilt retains the frontal distance reference', () => {
  for (const correctedWidth of [74, 21]) {
    const fit = lockedFit();
    const tilted = sample({ yaw: 0.75 });
    let value;
    for (let i = 0; i < 15; i++) value = fit.update(100, tilted.pose.facing,
      { width: correctedWidth, offset: 0, revision: 120 + i * 80, confidence: 0.8, support: 5 }, tilted.pose.anchors);
    near(value.width, correctedWidth, 0.05);
    assert.equal(value.revision, 1);
    // Turning back at the same distance must not enlarge the new fit.
    for (let i = 0; i < 24; i++) value = fit.update(100, 1, undefined, sample().pose.anchors);
    near(value.width, correctedWidth, 0.05);
  }
});

test('scale recovery tolerates one ambiguous scan without counting it as confirmation', () => {
  const fit = lockedFit(), anchors = sample().pose.anchors;
  let value;
  for (let i = 0; i < 8; i++) {
    value = fit.update(100, 1, { width: i === 1 ? 90 : 60, offset: 0, revision: 120 + i * 80,
      confidence: i === 1 ? 0.4 : 0.75, support: 6 }, anchors);
    near(value.width, i < 3 ? 40 : 60);
  }
  assert.equal(value.revision, 1);
});

test('clear scale recovery can complete on slow iPad inference without accepting ambiguous scans', () => {
  for (const support of [4, 5, 6]) {
    const fit = lockedFit(), anchors = sample({ yaw: 0.6 }).pose.anchors;
    let value;
    for (let i = 0; i < 14; i++) {
      value = fit.update(100, 0.8, { width: 60, offset: 0, revision: 800 + i * 800,
        confidence: i === 4 ? 0.4 : 0.9, support }, anchors);
      if (i < 5) near(value.width, 40);
    }
    near(value.width, 60);
    assert.equal(value.revision, 1);
  }
});

test('large scale refits ease both ways even on slow frames with stationary skin', () => {
  for (const targetWidth of [74, 21]) {
    const filter = new RingPoseFilter(), initial = { ...placement(sample()), fitRevision: 0 };
    filter.update(initial, 0);
    let value = initial;
    for (let i = 1; i <= 20; i++) {
      const previousWidth = value.width;
      value = filter.update({ ...initial, width: targetWidth, fitRevision: 1,
        imageMotion: { before: initial.anchors, after: initial.anchors } }, i * 100);
      assert.ok(Math.abs(Math.log(value.width / previousWidth)) <= 0.180001, 'large refit must not snap');
    }
    near(value.width, targetWidth, targetWidth * 0.015);
  }
});

test('scale recovery completes despite ordinary edge variation and intermittent ambiguity', () => {
  const fit = lockedFit(), anchors = sample().pose.anchors;
  const variation = [1, 0.95, 1.04, 1.01, 0.96, 1.03];
  let value;
  for (let i = 0; i < 18; i++) value = fit.update(100, 0.9,
    { width: 60 * variation[i % variation.length], offset: 0, revision: 120 + i * 80,
      confidence: i % 5 === 3 ? 0.4 : 0.8, support: 5 }, anchors);
  assert.equal(value.revision, 1, 'clear evidence should accumulate instead of restarting at every 4% deviation');
  near(value.width, 60, 2);
});

test('image-depth pose follows pitch and sideways tilt without inheriting a biased world normal', () => {
  for (const mirror of [false, true]) for (const yaw of [-0.75, 0, 0.75, Math.PI]) for (const pitch of [-0.55, 0.55]) {
    const s = sample({ yaw, pitch, mirror });
    const landmarks = s.landmarks.map(p => ({ ...p, z: p.z * 2000 / 900 }));
    const biased = sample({ yaw: yaw + 0.6, pitch: pitch - 0.3, mirror });
    for (let i = 0; i < landmarks.length; i++) Object.assign(landmarks[i], {
      worldX: biased.landmarks[i].worldX, worldY: biased.landmarks[i].worldY, worldZ: biased.landmarks[i].worldZ,
    });
    const observed = solveRingPose(landmarks, s.screen, 'Left', mirror, undefined, 900);
    assert.ok(observed.imageDepth);
    const expectedNormal = new Vector3(0, 0, -1).applyQuaternion(
      new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'ZYX')));
    if (mirror) expectedNormal.x *= -1;
    near(new Vector3(0, 0, 1).applyQuaternion(observed.orientation).distanceTo(expectedNormal), 0, 1e-6);
    const expectedAxis = new Vector3(0, 1, 0).applyQuaternion(
      new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'ZYX')));
    if (mirror) expectedAxis.x *= -1;
    near(new Vector3(0, 1, 0).applyQuaternion(observed.orientation).distanceTo(expectedAxis), 0, 0.06);
    const constraint = new RingSurfaceConstraint();
    const constrained = constraint.update(observed.orientation, observed.anchors, observed.fingerLength, 40, true);
    near(constrained.angleTo(observed.orientation), 0, 1e-6);
  }
});

test('captured frontal views keep the palm shank and dorsal setting near the guide crossing', async () => {
  const captures = JSON.parse(await readFile(new URL('./fixtures/frontal-ring-alignment.json', import.meta.url), 'utf8'));
  for (const capture of captures) {
    const scale = Math.max(capture.viewport.width / capture.video.width, capture.viewport.height / capture.video.height);
    const imageWidth = capture.video.width * scale, imageHeight = capture.video.height * scale;
    const screen = capture.hand.landmarks.map(p => ({ x: p.x * imageWidth, y: p.y * imageHeight }));
    const pose = solveRingPose(capture.hand.landmarks, screen, capture.hand.handedness, false, undefined, imageWidth);
    const axis = new Vector3(0, 1, 0).applyQuaternion(pose.orientation);
    const normal = new Vector3(0, 0, 1).applyQuaternion(pose.orientation);
    assert.ok(Math.hypot(normal.x, normal.y) * 0.8 < 0.025,
      'the visible or hidden setting center must stay within 2.5% of finger width from the crossing');
    if (capture.view === 'palm') {
      // At the near shank (half a diameter), pitch must not bow the band
      // visibly below the screen-space cross-section through its center.
      assert.ok(Math.abs(axis.z) * 0.5 < 0.04, 'palm shank offset must be under 4% of finger width');
      assert.ok(normal.z > 0.9, 'the setting must stay hidden on the far side');
    } else {
      // The center setting is roughly 0.8 diameters from the band origin.
      assert.ok(Math.hypot(normal.x, normal.y) * 0.8 < 0.06, 'setting center must stay near the guide intersection');
      assert.ok(normal.z < -0.9);
    }
    const projected = projectedFingerAxis(pose.orientation);
    const dx = screen[14].x - screen[13].x, dy = screen[14].y - screen[13].y;
    near(projected.x, dx / Math.hypot(dx, dy));
    near(projected.y, dy / Math.hypot(dx, dy));
  }
});

test('agreed small palm and dorsal tilts survive frontal depth reconciliation', () => {
  for (const yaw of [-0.2, 0.2, Math.PI - 0.2, Math.PI + 0.2]) for (const pitch of [-0.2, 0.2]) {
    const s = sample({ yaw, pitch });
    const landmarks = s.landmarks.map(p => ({ ...p, z: p.z * 2000 / 900 }));
    const measured = solveRingPose(landmarks, s.screen, 'Left', false, undefined, 900);
    const imageOnly = solveRingPose(landmarks.map(({ x, y, z }) => ({ x, y, z })), s.screen, 'Left', false, undefined, 900);
    near(measured.orientation.angleTo(imageOnly.orientation), 0, 1e-6);
  }
});

test('captured foreshortening strengthens pitch and both turn directions without disturbing the frontal palm', async () => {
  const captures = JSON.parse(await readFile(new URL('./fixtures/hand-turn-directions.json', import.meta.url), 'utf8'));
  const reference = JSON.parse(await readFile(new URL('./fixtures/frontal-ring-alignment.json', import.meta.url), 'utf8'))[1];
  const solve = c => {
    const scale = Math.max(c.viewport.width / c.video.width, c.viewport.height / c.video.height);
    const width = c.video.width * scale, height = c.video.height * scale;
    const screen = c.hand.landmarks.map(p => ({ x: p.x * width, y: p.y * height }));
    return solveRingPose(c.hand.landmarks, screen, c.hand.handedness, false, undefined, width);
  };
  const base = solve(reference);
  for (const [i, capture] of captures.entries()) {
    const constraint = new RingSurfaceConstraint(), pose = solve(capture);
    constraint.update(base.orientation, base.anchors, base.fingerLength, reference.rendered.width, true, base.metricOrientation);
    const q = constraint.update(pose.orientation, pose.anchors, pose.fingerLength, capture.rendered.width, true, pose.metricOrientation);
    const axis = new Vector3(0, 1, 0).applyQuaternion(q);
    const normal = new Vector3(0, 0, 1).applyQuaternion(q);
    if (i < 2) assert.ok(axis.z < -0.74, 'a visibly shortened finger must pitch the ring away from the camera');
    if (i === 2) assert.ok(normal.x < -0.49, 'follow the first sideways turn');
    if (i === 3) assert.ok(normal.x > 0.44, 'follow the opposite sideways turn');
    if (i === 4) near(q.angleTo(pose.orientation), 0, 1e-6);
    const beforeAxis = projectedFingerAxis(pose.orientation), afterAxis = projectedFingerAxis(q);
    near(beforeAxis.x, afterAxis.x); near(beforeAxis.y, afterAxis.y);
  }
});

test('foreshortening supports both pitch signs and rejects a contradictory metric direction', () => {
  for (const sign of [-1, 1]) {
    const flat = sample(), actual = sample({ pitch: sign * 0.95 });
    const understated = sample({ pitch: sign * 0.3 });
    const constraint = new RingSurfaceConstraint();
    constraint.update(flat.pose.orientation, flat.pose.anchors, flat.pose.fingerLength, 40, true, flat.pose.orientation);
    const corrected = constraint.update(understated.pose.orientation, actual.pose.anchors, actual.pose.fingerLength, 40, true, actual.pose.orientation);
    assert.ok(new Vector3(0, 1, 0).applyQuaternion(corrected).z * sign > 0.65);
    const opposite = sample({ pitch: -sign * 0.95 });
    const rejected = constraint.update(understated.pose.orientation, actual.pose.anchors, actual.pose.fingerLength, 40, true, opposite.pose.orientation);
    near(rejected.angleTo(understated.pose.orientation), 0, 1e-6);
  }
});

test('clear edge confidence does not bypass position stabilization during a skin-tracking dropout', () => {
  const filter = new RingPoseFilter(), initial = { ...placement(sample()), width: 110, edgeConfidence: 0.92 };
  filter.update(initial, 0);
  let sum = 0;
  for (let i = 1; i <= 40; i++) {
    const shift = i % 2 ? 2 : -2;
    const result = filter.update({ ...initial, x: initial.x + shift,
      anchors: initial.anchors.map(p => ({ x: p.x + shift, y: p.y })) }, i * 90);
    sum += (result.x - initial.x) ** 2;
  }
  assert.ok(Math.sqrt(sum / 40) < 1.5, 'suppress alternating landmark motion even with clear width evidence');
});

test('a small persistent fit error follows the observed edges in either direction', () => {
  for (const width of [37.5, 42.5]) {
    const fit = lockedFit(), anchors = sample().pose.anchors;
    let result;
    for (let i = 0; i < 4; i++) result = fit.update(100, 1,
      { width, offset: 0, revision: 120 + i * 90, confidence: 0.92, support: 6 }, anchors);
    near(result.width, width);
    near(fit.update(100, 1, undefined, anchors).width, width);
  }
});

test('refitting a nonplanar palm cannot resize the ring when the same hand becomes flat', () => {
  const fit = lockedFit(), anchors = sample().pose.anchors;
  const deformed = anchors.map((p, i) => ({ x: p.x + (i === 2 ? 100 : 0), y: p.y }));
  let value;
  for (let i = 0; i < 12; i++) value = fit.update(100, 0.9,
    { width: 50, offset: 0, revision: 120 + i * 90, confidence: 0.9, support: 6 }, deformed);
  near(value.width, 50);
  for (let i = 0; i < 30; i++) near(fit.update(100, 1, undefined, anchors).width, 50);
  assert.equal(fit.diagnostics.fitRevision, 1, 'one correction must not start a refitting feedback loop');
});

test('stationary skin keeps its attachment and roll despite changing landmark shape', () => {
  const initial = { ...placement(sample()), width: 100, edgeConfidence: 0.9 };
  const filter = new RingPoseFilter(); filter.update(initial, 0);
  for (let i = 1; i < 30; i++) {
    const sign = i % 2 ? 1 : -1;
    const result = filter.update({ ...initial, x: initial.x + sign * 4,
      fingerLength: initial.fingerLength * (1 + sign * 0.04),
      anchors: initial.anchors.map((p, j) => ({ x: p.x + (j === 1 ? 8 * sign : 0), y: p.y })),
      orientation: initial.orientation.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * 0.04)),
      imageMotion: { before: initial.anchors, after: initial.anchors } }, i * 90);
    near(result.x, initial.x, 0.01);
    near(result.orientation.angleTo(initial.orientation), 0, 0.001);
  }
});

test('slow skin roll accumulates through the still hold instead of losing rotation', () => {
  const initial = { ...placement(sample()), edgeConfidence: 0.9 };
  const filter = new RingPoseFilter(); filter.update(initial, 0);
  const angle = 0.005;
  let value;
  for (let i = 1; i <= 60; i++) {
    const rotated = initial.anchors.map(p => ({
      x: initial.x + (p.x - initial.x) * Math.cos(angle) - (p.y - initial.y) * Math.sin(angle),
      y: initial.y + (p.x - initial.x) * Math.sin(angle) + (p.y - initial.y) * Math.cos(angle),
    }));
    value = filter.update({ ...initial,
      orientation: initial.orientation.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -angle * i)),
      imageMotion: { before: initial.anchors, after: rotated } }, i * 90);
  }
  const expected = initial.orientation.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -angle * 60));
  assert.ok(value.orientation.angleTo(expected) < 0.02);
});

test('a persistent initial screen-axis bias settles without releasing alternating roll noise', () => {
  const flat = { ...placement(sample()), edgeConfidence: 0.9 };
  const biased = { ...flat, orientation: flat.orientation.clone().premultiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.12)) };
  const filter = new RingPoseFilter(); filter.update(biased, 0);
  let value;
  for (let i = 1; i <= 22; i++) value = filter.update({ ...flat,
    imageMotion: { before: flat.anchors, after: flat.anchors } }, i * 90);
  assert.ok(value.orientation.angleTo(flat.orientation) < 0.015, 'a stable finger axis must correct a persistent tilt');
});

test('a confirmed pitch and return recenter a displaced skin attachment without a lateral slide', () => {
  const initial = { ...placement(sample()), width: 80, edgeConfidence: 0.9 };
  const filter = new RingPoseFilter(); filter.update(initial, 0);
  const shifted = { ...initial, x: initial.x + 6,
    imageMotion: { before: initial.anchors, after: initial.anchors.map(p => ({ x: p.x + 6, y: p.y })) } };
  filter.update(shifted, 90);
  let value;
  for (let i = 2; i <= 36; i++) {
    const pitched = sample({ pitch: i < 16 ? 0.75 : 0 });
    const orientation = initial.orientation.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), i < 16 ? 0.75 : 0));
    value = filter.update({ ...initial, orientation,
      anchors: pitched.pose.anchors, fingerLength: pitched.pose.fingerLength,
      imageMotion: { before: initial.anchors, after: initial.anchors } }, i * 90);
  }
  assert.ok(Math.abs(value.x - initial.x) < 2, `a turn must not preserve the old 6px sideways transport error: ${value.x - initial.x}`);
  assert.ok(value.orientation.angleTo(initial.orientation) < 0.025);
});

test('sideways turns keep the longitudinal attachment through palm and skin foreshortening', () => {
  for (const mirror of [false, true]) for (const direction of [-1, 1]) for (const useSkin of [false, true]) {
    const filter = new RingPoseFilter();
    let previous = placement(sample({ mirror, pitch: 0.2, roll: 0.35 }));
    filter.update(previous, 0);
    let maximumClimb = 0;
    for (let i = 1; i <= 90; i++) {
      const yaw = direction * 1.15 * Math.sin(Math.PI * Math.min(i, 60) / 60);
      const raw = { ...placement(sample({ mirror, pitch: 0.2, roll: 0.35, yaw })), edgeConfidence: 0.9 };
      if (useSkin) {
        // A rolling finger deforms the visible skin patch; its similarity map
        // can carry a small longitudinal error even with low residuals.
        const dx = raw.fingerSegment.tip.x - raw.fingerSegment.base.x;
        const dy = raw.fingerSegment.tip.y - raw.fingerSegment.base.y;
        const length = Math.hypot(dx, dy);
        raw.imageMotion = { before: previous.anchors,
          after: raw.anchors.map(p => ({ x: p.x + dx / length * 0.65, y: p.y + dy / length * 0.65 })) };
      }
      const value = filter.update(raw, i * 70);
      const dx = raw.fingerSegment.tip.x - raw.fingerSegment.base.x;
      const dy = raw.fingerSegment.tip.y - raw.fingerSegment.base.y;
      const error = ((value.x - raw.x) * dx + (value.y - raw.y) * dy) / Math.hypot(dx, dy);
      maximumClimb = Math.max(maximumClimb, Math.abs(error));
      previous = raw;
    }
    assert.ok(maximumClimb < 1.5, `mirror=${mirror}, turn=${direction}, skin=${useSkin}: climbed ${maximumClimb}px`);
  }
});

function centeringProjection(pose, base, tip) {
  const dx = tip.x - base.x, dy = tip.y - base.y, length = Math.hypot(dx, dy);
  const across = new Vector3(1, 0, 0).applyQuaternion(pose.orientation);
  return across.x * -dy / length - across.y * dx / length;
}

test('calibrated centering follows the anatomical across-axis through palm/dorsal turns and mirroring', () => {
  for (const mirror of [false, true]) {
    const filter = new FingerFitFilter();
    const start = sample({ mirror });
    const k = centeringProjection(start.pose, start.screen[13], start.screen[14]);
    for (const revision of [0, 50, 100]) filter.update(100, 1,
      { width: 64, offset: -10 * k, revision, confidence: 1, support: 6 }, undefined, k);
    let previousOffset = -10 * k;
    for (let frame = 0; frame <= 60; frame++) {
      const turned = sample({ mirror, yaw: Math.PI * frame / 60 });
      const projection = centeringProjection(turned.pose, turned.screen[13], turned.screen[14]);
      const fit = filter.update(100, turned.pose.facing,
        { width: 80, offset: 20, revision: 150 + frame * 50, confidence: 0.4, support: 2 }, undefined, projection);
      near(fit.width, 64, 1e-8);
      near(fit.offset, -10 * projection, 1e-8);
      assert.ok(Math.abs(fit.offset - previousOffset) < 1, 'centering must turn continuously, including the side view');
      previousOffset = fit.offset;
    }
    assert.ok(previousOffset * k > 9.9, 'opposite view must reverse the screen centering correction');
  }
});

test('the supplied palm calibration recenters the later dorsal capture on the observed finger', () => {
  // Camera-space measurements from 09-18-15 and 09-18-23. Unobscured
  // dorsal cross-sections bound the physical center to x238.15..245.71.
  const filter = new FingerFitFilter();
  for (const revision of [0, 50, 100]) filter.update(229.19542, 1,
    { width: 81.18587, offset: -10.31, revision, confidence: 0.89, support: 6 }, undefined, 0.99978);
  const fit = filter.update(251.32865, 1,
    { width: 116.2, offset: 6.27, revision: 150, confidence: 0.25, support: 3 }, undefined, -0.99991);
  const boneCenter = { x: 230.58, y: 432.02 };
  const dx = 229.34541 - 231.97822, dy = 328.93538 - 548.27472;
  const x = boneCenter.x - dy / Math.hypot(dx, dy) * fit.offset;
  assert.ok(x >= 238.15 && x <= 245.71, `ring center ${x} must remain on the observed dorsal skin`);
  assert.ok(fit.offset > 10, 'uncertain dorsal scans cannot preserve the old palm correction sign');
});

test('distance recovery deprojects centering before learning from the opposite view', () => {
  const filter = new FingerFitFilter();
  const anchors = [{ x: 0, y: 100 }, { x: -60, y: 0 }, { x: -20, y: -15 }, { x: 25, y: -10 }, { x: 55, y: 0 }];
  for (const revision of [0, 50, 100]) filter.update(100, 1,
    { width: 40, offset: -4, revision, confidence: 1, support: 6 }, anchors, 1);
  let fit;
  for (let frame = 0; frame < 20; frame++) fit = filter.update(100, 1,
    { width: 48, offset: 4.8, revision: 200 + frame * 80, confidence: 1, support: 6 }, anchors, -1);
  near(fit.width, 48, 1e-6); near(fit.offset, 4.8, 1e-6);
  const returned = filter.update(100, 1,
    { width: 60, offset: 10, revision: 2000, confidence: 0.4, support: 2 }, anchors, 1);
  near(returned.offset, -4.8, 1e-6);
});
