import test from 'node:test';
import assert from 'node:assert/strict';
import { CylinderGeometry, DoubleSide, Euler, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three';
import { RingFingerShadow } from '../src/ring-finger-shadow.ts';
import { placeFingerOccluder } from '../src/finger-occluder.ts';
import { SoftRingOcclusion } from '../src/soft-ring-occlusion.ts';

test('the shadow receiver hugs the measured finger on side turns and steep pitches', () => {
  const shadow = new RingFingerShadow(), skin = new Mesh(new CylinderGeometry(1, 1, 1, 64, 1, false), new MeshBasicMaterial({ side: DoubleSide }));
  let maximumGap = 0;
  for (const pitch of [-1.35, -.7, 0, .7, 1.35]) for (const yaw of [-1.2, 0, 1.2]) {
    const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, .2));
    placeFingerOccluder(skin, .15, -.1, q, .2); shadow.update(.15, -.1, q, .2);
    skin.updateMatrixWorld(true); shadow.receiver.updateMatrixWorld(true);
    const center = new Vector3(.15, -.1, 0);
    for (let i = 0; i < 16; i++) {
      // Sample face interiors; a ray exactly on the duplicated cylinder seam
      // can miss its one-sided triangle through floating-point roundoff.
      const angle = (i + .2) * Math.PI / 8;
      const direction = new Vector3(Math.cos(angle), 0, Math.sin(angle)).applyQuaternion(q);
      const ray = new Raycaster(center.clone().addScaledVector(direction, 1), direction.clone().negate());
      const finger = ray.intersectObject(skin)[0], receiver = ray.intersectObject(shadow.receiver)[0];
      assert.ok(finger && receiver);
      const gap = receiver.point.distanceTo(finger.point) / .2;
      maximumGap = Math.max(maximumGap, gap);
      assert.ok(gap < .002, `shadow floats ${gap} finger diameters above the skin`);
    }
  }
  assert.ok(maximumGap > 0, 'retain a small offset to prevent surface fighting');
  skin.geometry.dispose(); skin.material.dispose(); shadow.dispose();
});

test('the softened shadow program retains its cache identity after hand clipping is installed', () => {
  const shadow = new RingFingerShadow(), occlusion = new SoftRingOcclusion();
  const before = shadow.receiver.material.customProgramCacheKey();
  occlusion.install(shadow.receiver.material, false);
  const after = shadow.receiver.material.customProgramCacheKey();
  assert.ok(after.includes(before), 'hand clipping must not silently reuse the old hard-shadow GPU program');
  assert.notEqual(after, before);
  shadow.dispose(); occlusion.dispose();
});
