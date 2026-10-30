import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3, Euler } from 'three';
import { handMaskPose } from '../src/occlusion-pose.ts';

const pose = (changes = {}) => ({ x: 310, y: 260, width: 80, orientation: new Quaternion(),
  fingerLength: 140, handScale: 220, anchors: [], surfaceFacing: 1, ...changes });
const worldCenter = p => new Vector3((p.x - 400) / 300, (300 - p.y) / 300, 0);
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-9);

test('ring position smoothing cannot slide a neighboring finger mask off its observed skin', () => {
  const raw = pose(), filtered = pose({ x: 290, y: 270 });
  const matrix = handMaskPose(raw, filtered, 800, 600);
  close(worldCenter(raw).applyMatrix4(matrix), worldCenter(raw));
  const point = worldCenter(raw).add(new Vector3(.1, .2, .3));
  close(point.clone().applyMatrix4(matrix), point);
});

test('filtered ring rotation reconciles hand depth while preserving the camera silhouette', () => {
  const raw = pose({ orientation: new Quaternion().setFromEuler(new Euler(.3, .5, -.2)) });
  const filtered = pose({ x: 330, y: 280, width: 88, orientation: new Quaternion().setFromEuler(new Euler(.2, .4, -.1)) });
  const before = raw.orientation.toArray();
  const localPoint = new Vector3(.2, -.1, .3);
  const point = localPoint.clone().applyQuaternion(raw.orientation).add(worldCenter(raw));
  const expected = localPoint.clone().multiplyScalar(1.1).applyQuaternion(filtered.orientation).add(worldCenter(filtered));
  const result = point.clone().applyMatrix4(handMaskPose(raw, filtered, 800, 600));
  assert.ok(Math.abs(result.z - expected.z) < 1e-9);
  assert.equal(result.x, point.x); assert.equal(result.y, point.y);
  assert.deepEqual(raw.orientation.toArray(), before);
});

test('a recorded static pose leaves the hand mask unchanged', () => {
  const current = pose({ orientation: new Quaternion().setFromEuler(new Euler(1.4, -.6, .2)) });
  const point = new Vector3(.7, -.3, .2);
  close(point.clone().applyMatrix4(handMaskPose(current, current, 800, 600)), point);
});
