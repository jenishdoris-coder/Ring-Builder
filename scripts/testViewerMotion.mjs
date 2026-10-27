import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { PerspectiveCamera, Vector3 } from "three";

const load = async path => {
  const code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
};
const { DampedRingZoom } = await load("src/utils/ringZoom.ts");
const { waitForCompleteRingFrame } = await load("src/utils/viewerFrame.ts");
const fixture = () => {
  const camera = new PerspectiveCamera(45, 1, .01, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return { camera, controls: { enabled: true, enableZoom: true, target: new Vector3(), minDistance: 3, maxDistance: 15, zoomSpeed: 2 }, zoom: new DampedRingZoom() };
};
const { camera, controls, zoom } = fixture();
assert.equal(zoom.add(-100, camera, controls), true);
assert.equal(camera.position.z, 10, "wheel input queues motion without an immediate jump");
zoom.advance(camera, controls, 1 / 60);
const first = camera.position.z;
zoom.advance(camera, controls, 1 / 60);
assert.ok(camera.position.z < first, "zoom continues after the wheel stops");
const secondStep = first - camera.position.z;
zoom.advance(camera, controls, 1 / 60);
assert.ok(camera.position.z > 0 && camera.position.z < first);
assert.ok(secondStep > first - secondStep - camera.position.z, "the zoom glide slows down");
for (let frame = 0; frame < 180; frame++) zoom.advance(camera, controls, 1 / 60);
assert.equal(zoom.active, false);
assert.ok(camera.position.z < 10 && camera.position.z > 3);
const endpoint = rate => {
  const item = fixture(); item.zoom.add(-100, item.camera, item.controls);
  for (let frame = 0; frame < rate; frame++) item.zoom.advance(item.camera, item.controls, 1 / rate);
  return item.camera.position.z;
};
assert.ok(Math.abs(endpoint(30) - endpoint(120)) < 1e-8, "zoom speed is independent of display frame rate");
for (let step = 0; step < 100; step++) zoom.add(-240, camera, controls);
for (let frame = 0; frame < 180; frame++) zoom.advance(camera, controls, 1 / 60);
assert.equal(camera.position.distanceTo(controls.target), 3, "inertia respects zoom limits");
zoom.add(100, camera, controls); zoom.stop();
const stopped = camera.position.clone();
zoom.advance(camera, controls, 1 / 60);
assert.deepEqual(camera.position.toArray(), stopped.toArray(), "preset changes and capture locks cancel pending movement");
const hand = fixture(); hand.controls.zoomToCursor = true;
hand.zoom.add(-100, hand.camera, hand.controls, { x: .5, y: 0 });
hand.zoom.advance(hand.camera, hand.controls, 1 / 60);
assert.ok(hand.camera.position.x > 0 && hand.controls.target.x > 0, "hand zoom stays anchored towards the pointer");

const viewerFixture = () => {
  const events = new Map();
  const activeCamera = {};
  let reset = 0;
  const viewer = {
    scene: { activeCamera, renderCamera: activeCamera }, setDirty() {},
    getPluginByType: () => ({ pass: { passObject: { onSizeUpdate: () => reset++ } } }),
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(callback); },
    removeEventListener(type, callback) { events.get(type)?.delete(callback); },
    emit(type) { for (const callback of [...events.get(type) || []]) callback(); },
  };
  return { viewer, events, reset: () => reset };
};
const live = viewerFixture();
let saved = false;
const complete = waitForCompleteRingFrame(live.viewer, () => true).then(value => { saved = value; return value; });
live.viewer.scene.renderCamera = {};
live.viewer.emit("postRender"); await Promise.resolve();
assert.equal(saved, false, "photo-camera renders cannot satisfy the live-frame barrier");
live.viewer.scene.renderCamera = live.viewer.scene.activeCamera;
live.viewer.emit("postRender"); await Promise.resolve();
assert.equal(saved, false, "the penultimate frame is not preserved for gallery generation");
live.viewer.emit("postRender");
assert.equal(await complete, true);
assert.equal(live.reset(), 1, "partial dissolve history is discarded");
assert.equal(live.events.get("postRender").size, 0);
const disposed = viewerFixture();
const cancelled = waitForCompleteRingFrame(disposed.viewer, () => true);
disposed.viewer.emit("dispose");
assert.equal(await cancelled, false, "closing a viewer releases a pending capture barrier");
assert.equal(disposed.events.get("postRender").size, 0);
console.log("Viewer motion checks passed: zoom glide, damping, limits, frame rate, cursor anchor, and complete dissolve frames before capture.");
