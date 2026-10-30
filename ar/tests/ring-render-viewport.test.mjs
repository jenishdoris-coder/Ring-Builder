import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3, OrthographicCamera } from 'three';
import { cropRingCamera, ringRenderViewport } from '../src/ring-render-viewport.ts';

test('cropped rendering preserves the full-page pixel position through hand movement', () => {
  const width = 1024, height = 1366;
  for (const center of [new Vector3(), new Vector3(-0.6, 0.8, 0), new Vector3(0.65, -0.9, 0)]) {
    const bounds = new Box3(center.clone().addScalar(-0.1), center.clone().addScalar(0.1));
    const viewport = ringRenderViewport(bounds, width, height);
    const camera = new OrthographicCamera(-width / height, width / height, 1, -1, 0.1, 100);
    camera.position.z = 4;
    camera.updateMatrixWorld();
    const point = center.clone().add(new Vector3(0.06, -0.03, 0.02));
    const full = point.clone().project(camera);
    cropRingCamera(camera, viewport, width, height);
    const crop = point.clone().project(camera);
    assert.ok(Math.abs((crop.x + 1) * viewport.width / 2 + viewport.x - (full.x + 1) * width / 2) < 1e-9);
    assert.ok(Math.abs((1 - crop.y) * viewport.height / 2 + viewport.y - (1 - full.y) * height / 2) < 1e-9);
    assert.ok(Math.abs(crop.z - full.z) < 1e-12, 'hand depth comparisons stay unchanged');
    assert.ok(viewport.width * viewport.height < width * height * 0.05, 'small jewelry avoids full-screen buffers');
  }
});

test('small scale corrections reuse buffer sizes and rotated bounds remain inside the crop', () => {
  const width = 1024, height = 1366;
  const a = new Box3(new Vector3(-0.12, -0.16, -0.1), new Vector3(0.12, 0.16, 0.1));
  const first = ringRenderViewport(a, width, height);
  const next = ringRenderViewport(a.clone().expandByScalar(-0.008), width, height, first);
  assert.equal(next.width, first.width);
  assert.equal(next.height, first.height);
  const camera = new OrthographicCamera();
  camera.position.z = 4;
  cropRingCamera(camera, first, width, height);
  for (const x of [a.min.x, a.max.x]) for (const y of [a.min.y, a.max.y]) {
    const projected = new Vector3(x, y, 0).project(camera);
    assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
  }
});

test('viewport resizing clamps allocations to the current display', () => {
  const bounds = new Box3(new Vector3(-3, -3, -1), new Vector3(3, 3, 1));
  const viewport = ringRenderViewport(bounds, 504, 920, {x:0,y:0,width:1024,height:1366});
  assert.deepEqual(viewport, {x:0,y:0,width:504,height:920});
});
