import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { replayRecordedHand } from '../src/occlusion-replay.ts';
import { palmOcclusionTriangles, PALM_MASK_VERTEX_COUNT } from '../src/hand-occlusion.ts';

test('recorded bent-hand depth stays aligned when resized to a landscape viewport', async () => {
  const capture = JSON.parse(await readFile(new URL('./fixtures/fist-occlusion.json', import.meta.url), 'utf8'));
  const original = replayRecordedHand(capture, 504, 920);
  const resized = replayRecordedHand(capture, 1280, 720);
  const a = palmOcclusionTriangles(original.mask.landmarks, original.mask.screen, original.placement);
  const b = palmOcclusionTriangles(resized.mask.landmarks, resized.mask.screen, resized.placement);
  assert.equal(b.length, PALM_MASK_VERTEX_COUNT);
  const scale = resized.placement.width / original.placement.width;
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs((b[i].x - resized.placement.x) - (a[i].x - original.placement.x) * scale) < 1e-8);
    assert.ok(Math.abs((b[i].y + resized.placement.y) - (a[i].y + original.placement.y) * scale) < 1e-8);
    assert.ok(Math.abs(b[i].z - a[i].z * scale) < 1e-8);
  }
  assert.ok(resized.placement.orientation.angleTo(original.placement.orientation) < 1e-7);
});
