import test from 'node:test';
import assert from 'node:assert/strict';
import { FingerTrackingWindow, FINGER_TRACKING_RESOLUTION, fingerMotionToVideo } from '../src/finger-tracking-window.ts';
import { PatchMotionTracker } from '../src/patch-motion.ts';
import { fitPalmMotion } from '../src/ring-tracking.ts';

const region = (x = 800, y = 450, length = 110) => [{ x: x / 1600, y: y / 900 }, { x: x / 1600, y: (y - length) / 900 }];
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

test('a narrow finger receives usable texture detail without a full-frame processing increase', () => {
  const crop = new FingerTrackingWindow().update(1600, 900, region(), 36);
  assert.ok(crop);
  assert.ok(crop.fingerWidth >= 45, '36 camera pixels must not shrink to the old 7.2px whole-frame finger');
  assert.ok(FINGER_TRACKING_RESOLUTION ** 2 <= 320 * 240, 'keep image processing below the old landscape pixel budget');
  for (const p of crop.region) assert.ok(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1);
});

test('landmark jitter does not recrop a still finger or destroy its reference image', () => {
  const tracker = new FingerTrackingWindow();
  const first = tracker.update(1600, 900, region(), 36);
  for (let i = 0; i < 40; i++) {
    const next = tracker.update(1600, 900, region(800 + Math.sin(i) * 3, 450 + Math.cos(i) * 3), 36);
    assert.equal(next.changed, false);
    assert.deepEqual(next.window, first.window);
  }
});

test('crop changes and camera zoom cannot add artificial attachment motion', () => {
  const tracker = new FingerTrackingWindow();
  const first = tracker.update(1600, 900, region(), 36);
  const next = tracker.update(1600, 900, region(1000, 490, 170), 58);
  assert.ok(next.changed);
  const before = [{ x: 800, y: 400 }, { x: 810, y: 410 }];
  const after = before.map(p => ({ x: p.x + 200, y: p.y + 40 }));
  const local = (p, w) => ({ x: (p.x - w.x) / w.size, y: (p.y - w.y) / w.size });
  const converted = fingerMotionToVideo({ before: before.map(p => local(p, first.window)), after: after.map(p => local(p, next.window)) }, next.previous, next.window);
  converted.before.forEach((p, i) => { near(p.x * 1600, before[i].x); near(p.y * 900, before[i].y); });
  converted.after.forEach((p, i) => { near(p.x * 1600, after[i].x); near(p.y * 900, after[i].y); });
  assert.equal(fingerMotionToVideo(converted, null, next.window), null);
});

// Sample a textured strip from a synthetic full-resolution camera. The real
// patch matcher sees only the actual fixed-size crop and the local anatomy.
function cameraCrop(window, translation) {
  const width = FINGER_TRACKING_RESOLUTION, height = width, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = window.x + (x + .5) / width * window.size - translation;
    const gy = window.y + (y + .5) / height * window.size;
    const skin = Math.abs(gx - 800) < 18 && gy > 335 && gy < 455;
    const v = skin ? 140 + 22 * Math.sin(gx * .43) * Math.cos(gy * .37)
      + 15 * Math.sin(gx * .17 + gy * .23) + 12 * Math.cos(gx * .63 - gy * .19) : 30;
    const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { width, height, data };
}

test('real patch matching follows small skin movement and a window reframe in camera coordinates', () => {
  const cropper = new FingerTrackingWindow(), motion = new PatchMotionTracker();
  let checks = 0, maximumError = 0;
  // Cross the crop margin so at least one comparison uses two different crops.
  let reframes = 0;
  for (let i = 0; i < 40; i++) {
    const shifted = i * 2;
    const tracked = cropper.update(1600, 900, region(800 + shifted), 36);
    if (i && tracked.changed) reframes++;
    const local = motion.update(cameraCrop(tracked.window, shifted), tracked.region, i * 33, tracked.fingerWidth);
    const global = fingerMotionToVideo(local, tracked.previous, tracked.window);
    if (!global) continue;
    const fit = fitPalmMotion(global.before.map(p => ({ x: p.x * 1600, y: p.y * 900 })), global.after.map(p => ({ x: p.x * 1600, y: p.y * 900 })));
    assert.ok(fit);
    const point = { x: 800 + shifted - 2, y: 395 }, mapped = fit.map(point);
    maximumError = Math.max(maximumError, Math.hypot(mapped.x - point.x - 2, mapped.y - point.y));
    checks++;
  }
  assert.ok(reframes > 0, 'exercise coordinate recovery across a real crop reframe');
  assert.ok(checks >= 32, `skin flow available for ${checks}/39 frame pairs`);
  assert.ok(maximumError < .8, `maximum skin attachment error ${maximumError}px`);
});

test('portrait cameras, image edges, invalid bones and camera changes have bounded windows', () => {
  const tracker = new FingerTrackingWindow();
  for (const p of [[.02, .1], [.97, .95]]) {
    const tracked = tracker.update(720, 1280, [{ x: p[0], y: p[1] }, { x: p[0], y: p[1] - .06 }], 24);
    assert.ok(tracked.window.x >= 0 && tracked.window.y >= 0);
    assert.ok(tracked.window.x + tracked.window.size <= 720);
    assert.ok(tracked.window.y + tracked.window.size <= 1280);
  }
  const changed = tracker.update(1600, 900, region(), 36);
  assert.equal(changed.previous, null);
  assert.equal(tracker.update(1600, 900, [{ x: NaN, y: 0 }, { x: 0, y: 0 }]), null);
  assert.equal(tracker.diagnostics, null);
});
