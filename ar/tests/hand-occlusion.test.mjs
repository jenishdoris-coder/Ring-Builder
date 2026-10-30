import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3, Quaternion, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Raycaster, SphereGeometry, CylinderGeometry, Group } from 'three';
import { handOcclusionSegments, handOcclusionJoints, palmOcclusionTriangles, selectHandOcclusion, HandOcclusionStabilizer, PALM_MASK_VERTEX_COUNT } from '../src/hand-occlusion.ts';

function maskSnapshot() {
  const screen = Array.from({ length: 21 }, (_, i) => ({ x: 150 + i * 8, y: 400 - i * 5 }));
  return { width: 504, height: 920, mode: 'environment', screen,
    landmarks: screen.map(p => ({ x: p.x / 504, y: p.y / 920, z: 0, worldZ: 0 })) };
}
const maskRing = { width: 70, handScale: 200, imageDepthScale: 504 };

test('confirmed ring-finger stillness suppresses neighboring mask jitter without freezing a crossing finger', () => {
  const original = maskSnapshot();
  let held = original;
  for (let frame = 0; frame < 30; frame++) {
    const sign = frame % 2 ? 1 : -1;
    const noisy = { ...original,
      screen: original.screen.map((p, i) => ({ x: p.x + sign * (1 + i % 3), y: p.y - sign * (1 + i % 3) })),
      landmarks: original.landmarks.map((p, i) => ({ ...p, z: sign * (1 + i % 3) / 504 })) };
    held = selectHandOcclusion(held, noisy, true, maskRing);
    assert.deepEqual(handOcclusionSegments(held.landmarks, held.screen, maskRing),
      handOcclusionSegments(original.landmarks, original.screen, maskRing));
  }
  const crossing = { ...original,
    screen: original.screen.map((p, i) => i >= 5 && i <= 8 ? { ...p, x: p.x + 70 } : { ...p, x: p.x + 2 }),
    landmarks: original.landmarks.map((p, i) => i >= 5 && i <= 8 ? { ...p, x: p.x + 70 / 504, z: -0.05 } : { ...p, z: 0.005 }) };
  const selected = selectHandOcclusion(held, crossing, true, maskRing);
  for (const i of [5, 6, 7, 8]) {
    assert.deepEqual(selected.screen[i], crossing.screen[i]);
    assert.deepEqual(selected.landmarks[i], crossing.landmarks[i]);
  }
  for (const i of [0, 13, 14, 15, 16, 17, 18, 19, 20]) {
    assert.deepEqual(selected.screen[i], original.screen[i]);
    assert.deepEqual(selected.landmarks[i], original.landmarks[i]);
  }
  const before = handOcclusionSegments(held.landmarks, held.screen, maskRing)[3];
  const after = handOcclusionSegments(selected.landmarks, selected.screen, maskRing)[3];
  assert.equal(after.a.x - before.a.x, 70, 'the index mask follows its crossing immediately');
  assert.equal(after.a.z - before.a.z, 0.05 * 504, 'its depth follows without moving the ring reference');
});

test('neighboring finger movement accumulates and depth-only crossings release independently', () => {
  const original = maskSnapshot();
  let held = original;
  for (let step = 1; step <= 8; step++) {
    const current = { ...original, screen: original.screen.map((p, i) => i >= 9 && i <= 12 ? { ...p, x: p.x + step } : p) };
    held = selectHandOcclusion(held, current, true, maskRing);
  }
  assert.ok(held.screen[10].x >= original.screen[10].x + 7, 'small coherent steps eventually release the held mask');
  const closer = { ...original,
    landmarks: original.landmarks.map((p, i) => i >= 17 && i <= 20 ? { ...p, z: -0.04 } : p) };
  const selected = selectHandOcclusion(original, closer, true, maskRing);
  assert.deepEqual(selected.landmarks[18], closer.landmarks[18]);
  assert.deepEqual(selected.landmarks[13], original.landmarks[13]);
  const bent = { ...original, screen: original.screen.map((p, i) => i === 8 ? { ...p, y: p.y - 20 } : p) };
  assert.deepEqual(selectHandOcclusion(original, bent, true, maskRing).screen[8], bent.screen[8],
    'a substantial single-joint bend also updates its chain');
});

test('occlusion selection releases for hand motion or changed screen projection', () => {
  const original = maskSnapshot();
  const current = { ...original, screen: original.screen.map(p => ({ x: p.x + 1, y: p.y + 1 })) };
  assert.equal(selectHandOcclusion(original, current, false, maskRing), current);
  assert.equal(selectHandOcclusion(original, { ...current, width: 700 }, true, maskRing).width, 700);
  assert.deepEqual(selectHandOcclusion(original, { ...current, height: 1100 }, true, maskRing).screen, current.screen);
  assert.deepEqual(selectHandOcclusion(original, { ...current, mode: 'user' }, true, maskRing).screen, current.screen);
  assert.equal(selectHandOcclusion(null, current, true, maskRing), current);
});

test('captured fist hides the band over the palm while leaving the raised stone visible', async () => {
  const s = JSON.parse(await readFile(new URL('./fixtures/fist-occlusion.json', import.meta.url), 'utf8'));
  const { width, height } = s.viewport;
  const scale = Math.max(width / s.video.width, height / s.video.height);
  const screen = s.hand.landmarks.map(p => ({
    x: (width - s.video.width * scale) / 2 + p.x * s.video.width * scale,
    y: (height - s.video.height * scale) / 2 + p.y * s.video.height * scale,
  }));
  const ring = { ...s.rendered, orientation: new Quaternion().fromArray(s.rendered.orientation) };
  const points = palmOcclusionTriangles(s.hand.landmarks, screen, ring);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld();
  const center = new Vector3(ring.x, -ring.y, 0);
  const covered = p => {
    const hit = new Raycaster(new Vector3(p.x, p.y, 1000), new Vector3(0, 0, -1)).intersectObject(mesh)[0];
    return !!hit && hit.point.z > p.z;
  };
  let hiddenBand = 0;
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI / 32;
    const point = new Vector3(Math.cos(angle) * ring.width * 0.52, 0, Math.sin(angle) * ring.width * 0.52)
      .applyQuaternion(ring.orientation).add(center);
    if (covered(point)) hiddenBand++;
  }
  assert.ok(hiddenBand > 20, 'palm must cover the exposed rear arc');
  assert.equal(covered(new Vector3(0, 0, -ring.width * 0.785).applyQuaternion(ring.orientation).add(center)), false);
  assert.deepEqual(palmOcclusionTriangles([], [], ring), []);
  geometry.dispose(); material.dispose();
});

test('image-depth occlusion remains consistent when the separate world depth estimate changes', async () => {
  const s = JSON.parse(await readFile(new URL('./fixtures/fist-occlusion.json', import.meta.url), 'utf8'));
  const scale = Math.max(s.viewport.width / s.video.width, s.viewport.height / s.video.height);
  const imageDepthScale = s.video.width * scale;
  const screen = s.hand.landmarks.map(p => ({ x: p.x * imageDepthScale,
    y: p.y * s.video.height * scale }));
  const ring = { ...s.rendered, imageDepthScale };
  const points = palmOcclusionTriangles(s.hand.landmarks, screen, ring);
  const biased = s.hand.landmarks.map((p, i) => ({ ...p, worldZ: p.worldZ + i * 0.01 }));
  assert.deepEqual(palmOcclusionTriangles(biased, screen, ring), points);
  assert.equal(points.length, PALM_MASK_VERTEX_COUNT);
});

test('slowly crossing fingers follow the camera instead of waiting for a large mask jump', () => {
  const first = maskSnapshot(), filter = new HandOcclusionStabilizer();
  filter.update(first, true, maskRing, 0);
  let maximumError = 0;
  for (let i = 1; i <= 40; i++) {
    const current = { ...first, screen: first.screen.map((p, id) => id >= 9 && id <= 12 ? { x: p.x + i * .8, y: p.y } : p) };
    const result = filter.update(current, true, maskRing, i * 33);
    maximumError = Math.max(maximumError, current.screen[10].x - result.screen[10].x);
    assert.deepEqual(result.screen[13], first.screen[13], 'neighbor movement must not move the ring attachment');
  }
  assert.ok(maximumError < 1.4, `mask trails crossing skin by ${maximumError}px`);
});

test('alternating mask noise stays quiet while palm and depth-only crossings release', () => {
  const first = maskSnapshot(), filter = new HandOcclusionStabilizer();
  filter.update(first, true, maskRing, 0);
  let maximum = 0;
  for (let i = 1; i <= 40; i++) {
    const sign = i % 2 ? 1 : -1;
    const current = { ...first, screen: first.screen.map(p => ({ x: p.x + sign * 2, y: p.y })),
      landmarks: first.landmarks.map(p => ({ ...p, z: sign * 2 / maskRing.imageDepthScale })) };
    const result = filter.update(current, true, maskRing, i * 33);
    maximum = Math.max(maximum, Math.abs(result.screen[10].x - first.screen[10].x));
  }
  assert.ok(maximum < .6, `static mask noise ${maximum}px`);
  let result;
  for (let i = 1; i <= 8; i++) {
    const current = { ...first, screen: first.screen.map((p, id) => id === 0 ? { x: p.x, y: p.y + i * 2 } : p),
      landmarks: first.landmarks.map((p, id) => id >= 5 && id <= 8 ? { ...p, z: -i * 2 / maskRing.imageDepthScale } : p) };
    result = filter.update(current, true, maskRing, (40 + i) * 33);
  }
  assert.ok(result.screen[0].y > first.screen[0].y + 14, 'a bending palm can move while ring-finger skin stays still');
  assert.ok(result.landmarks[6].z < -14 / maskRing.imageDepthScale, 'nearer fingers must not stay behind the jewelry');
});

test('rounded finger joints occlude jewelry in the gap between bent bone cylinders', () => {
  const segments = [
    { a: new Vector3(-50, 0, 0), b: new Vector3(0, 0, 0), radius: 10, capEnd: true },
    { a: new Vector3(0, 0, 0), b: new Vector3(0, -50, 0), radius: 9, capEnd: false },
  ];
  const material = new MeshBasicMaterial({ side: DoubleSide }), group = new Group();
  for (const s of segments) {
    const mesh = new Mesh(new CylinderGeometry(1, 1, 1, 32), material);
    mesh.position.copy(s.a).add(s.b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), s.b.clone().sub(s.a).normalize());
    mesh.scale.set(s.radius, s.a.distanceTo(s.b), s.radius); group.add(mesh);
  }
  const covered = z => { group.updateMatrixWorld(true); const hit = new Raycaster(new Vector3(7, 7, 100), new Vector3(0, 0, -1)).intersectObject(group)[0]; return !!hit && hit.point.z > z; };
  assert.equal(covered(0), false, 'reproduce the old bent-joint gap');
  const joints = handOcclusionJoints(segments);
  for (const joint of joints) { const mesh = new Mesh(new SphereGeometry(1, 20, 12), material); mesh.position.copy(joint.position); mesh.scale.setScalar(joint.radius); group.add(mesh); }
  assert.equal(covered(0), true, 'the knuckle surface covers the band');
  assert.equal(covered(30), false, 'a raised setting remains in front');
  assert.equal(joints.some(j => j.position.distanceTo(segments[1].b) < 1e-6), false, 'do not extend beyond a fingertip');
  group.traverse(o => o.geometry?.dispose()); material.dispose();
});

test('palm coverage includes the wrist edges without hiding a raised setting', () => {
  const screen = Array.from({ length: 21 }, () => ({ x: 250, y: 300 }));
  Object.assign(screen, { 0: { x: 250, y: 500 }, 5: { x: 150, y: 330 }, 9: { x: 220, y: 310 }, 13: { x: 285, y: 320 }, 17: { x: 340, y: 340 } });
  const landmarks = screen.map(p => ({ ...p, z: 0, worldZ: 0 }));
  const points = palmOcclusionTriangles(landmarks, screen, { ...maskRing, width: 60 });
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
  const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const hit = new Raycaster(new Vector3(200, -480, 100), new Vector3(0, 0, -1)).intersectObject(mesh)[0];
  assert.ok(hit && hit.point.z > 0, 'cover the skin beside the wrist center');
  assert.ok(hit.point.z < 80, 'keep raised jewelry visible');
  geometry.dispose(); material.dispose();
});
