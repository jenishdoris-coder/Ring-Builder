import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { FingerStillnessTracker } from '../src/finger-stillness.ts';
import { RingPoseFilter } from '../src/ring-tracking.ts';

const region = [{ x: .5, y: .7 }, { x: .5, y: .3 }];
function image(frame, dx = 0, scale = 1, blank = false) {
  const width = 128, height = 192, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = 64 + (x - 64 - dx) / scale, v = 96 + (y - 96) / scale;
    const skin = blank ? 140 : 140 + 16 * Math.sin(u * .33) * Math.cos(v * .19)
      + 9 * Math.sin(v * .41 + u * .12) + 5 * Math.cos(u * .71 + v * .51);
    const noise = ((x * 37 + y * 71 + frame * 19) % 17 - 8) * .35;
    const value = Math.round(skin * (1 + .015 * Math.sin(frame * .4)) + 2 * Math.cos(frame * .21) + noise);
    const index = (y * width + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255;
  }
  return { width, height, data };
}

test('a fixed skin reference can confirm stable depth through subpixel tremor and sensor noise', () => {
  const tracker = new FingerStillnessTracker(); let confirmed = 0, positionUnlocked = 0;
  for (let frame = 0; frame < 45; frame++) {
    const shift = frame ? .32 * Math.sin(frame * .55) : 0;
    const movedRegion = region.map(p => ({ x: p.x + shift / 128, y: p.y }));
    const locked = tracker.update(image(frame, shift), movedRegion, frame * 50, 28);
    if (frame > 12 && tracker.diagnostics.poseStable) confirmed++;
    if (frame > 12 && !locked) positionUnlocked++;
  }
  assert.ok(confirmed >= 28, `stable depth confirmed on only ${confirmed} frames`);
  assert.ok(positionUnlocked > 0, 'depth stability must not imply a frozen screen position');
});

test('stable-depth evidence releases for accumulated translation, magnification and unobservable skin', () => {
  for (const motion of ['translation', 'zoom']) {
    const tracker = new FingerStillnessTracker();
    for (let frame = 0; frame <= 12; frame++) tracker.update(image(frame), region, frame * 50, 28);
    assert.equal(tracker.diagnostics.poseStable, true);
    let released = false;
    for (let frame = 1; frame <= 25; frame++) {
      const dx = motion === 'translation' ? frame * .12 : 0;
      const scale = motion === 'zoom' ? 1 + frame * .003 : 1;
      tracker.update(image(frame + 12, dx, scale), region.map(p => ({ x: p.x + dx / 128,
        y: .5 + (p.y - .5) * scale })), 600 + frame * 50, 28 * scale);
      if (!tracker.diagnostics.poseStable) released = true;
    }
    assert.ok(released, `${motion} cannot stay locked against a succession of tiny steps`);
  }
  const blank = new FingerStillnessTracker();
  for (let frame = 0; frame < 25; frame++) blank.update(image(frame, 0, 1, true), region, frame * 50, 28);
  assert.equal(blank.diagnostics.poseStable, false);
});

function placement(angle = 0, shift = 0) {
  return { x: 300 + shift, y: 400, width: 46, orientation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle),
    anchors: [{x:300,y:480},{x:360,y:350},{x:315,y:330},{x:275,y:345},{x:240,y:365}].map(p => ({x:p.x+shift,y:p.y})),
    surfaceFacing: 1, fingerLength: 80, handScale: 100, edgeConfidence: .4,
    fingerSegment: {base:{x:300+shift,y:442.4},tip:{x:300+shift,y:362.4},fraction:.53},
    imageStill: false, imagePoseStable: true };
}

test('stable skin holds inferred depth without stopping real surface translation and releases for a turn', () => {
  const filter = new RingPoseFilter(); filter.update(placement(), 0);
  let previousShift = 0, maximumAngle = 0, value, minX = Infinity, maxX = -Infinity;
  for (let frame = 1; frame <= 80; frame++) {
    const shift = .45 * Math.sin(frame * .63);
    const raw = placement(Math.floor(frame / 7) % 2 ? .13 : -.13, shift);
    const points = Array.from({length:8},(_,i)=>({x:292+(i%2)*16+previousShift,y:375+Math.floor(i/2)*16}));
    raw.imageMotion = {before:points,after:points.map(p=>({x:p.x+shift-previousShift,y:p.y}))};
    value = filter.update(raw, frame * 50); previousShift = shift;
    maximumAngle = Math.max(maximumAngle, value.orientation.angleTo(new Quaternion()));
    minX = Math.min(minX, value.x); maxX = Math.max(maxX, value.x);
  }
  assert.ok(maximumAngle < .005, `static skin still acquired ${maximumAngle} radians of depth wobble`);
  assert.ok(maxX - minX > .25, 'stable depth must not pin position while observed skin translates');
  // Now leave the fixed image reference: ordinary motion must resume rather
  // than retaining a permanent screen-facing ring.
  for (let frame = 81; frame <= 90; frame++) {
    value = filter.update({...placement(.45, 20), imagePoseStable:false}, frame * 50);
  }
  assert.ok(value.orientation.angleTo(placement(.45).orientation) < .04);
  assert.ok(Math.abs(value.x - 320) < 1);
});
