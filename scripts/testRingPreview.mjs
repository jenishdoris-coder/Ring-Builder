import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, SphereGeometry, Texture, TorusGeometry, Vector3 } from "three";

const threeUrl = pathToFileURL(resolve("node_modules/three/build/three.module.js")).href;
const mockSource = `export * from ${JSON.stringify(threeUrl)}; import {Vector3} from ${JSON.stringify(threeUrl)}; export class CameraController { constructor(camera) { this.cameraObject = camera; this.position = new Vector3(); this.target = new Vector3(); } dispose() { this.disposed = true; } }`;
const source = await readFile(resolve("src/utils/ringPreview.ts"), "utf8");
const tempPath = join(tmpdir(), `ring-preview-${randomUUID()}.mjs`);
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace('"webgi"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(mockSource).toString("base64")}`));
await writeFile(tempPath, output);
let preview;
try { preview = await import(pathToFileURL(tempPath).href); }
finally { await unlink(tempPath); }

// Fit the complete ring for wide, square, and narrow photo tiles.
const bounds = new Box3(new Vector3(-2, -1, -0.3), new Vector3(2, 4, 0.3));
for (const aspect of [0.7, 1, 1.5]) {
  for (const view of preview.RING_PREVIEW_VIEWS) {
    const camera = new PerspectiveCamera(25);
    preview.fitPreviewCamera(camera, bounds, new Vector3(...view.direction), new Vector3(...view.up), aspect);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, "the whole model stays inside each generated photo");
    }
  }
}

let onDecode;
const flips = [];
globalThis.Image = class {
  width = 32; height = 32;
  async decode() { onDecode?.(); }
};
globalThis.document = { createElement: () => {
  let drawn;
  return { getContext: () => ({ translate() {}, scale: (...args) => flips.push(args), drawImage: image => { drawn = image; } }), toDataURL: () => drawn.src };
} };
const root = new Group();
root.add(new Mesh(new BoxGeometry(3, 1, 5), new MeshBasicMaterial()));
root.rotation.set(Math.PI / 2, Math.PI, -1.22);
root.position.set(1, -0.35, 2);
const rootPose = { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() };
const makeViewer = () => {
  const activeCamera = { position: new Vector3(3, 4, 8), target: new Vector3(0, 1, 0) };
  const progressive = { enabled: true };
  const floorMaterial = new MeshBasicMaterial({ opacity: 0.7, alphaMap: new Texture() });
  const floor = new Mesh(new BoxGeometry(1, 1, 0.001), floorMaterial);
  floor.position.set(1, -4, 2);
  const ground = { mesh: { modelObject: floor }, material: floor.material, enableRefreshTransform: true, blurAmount: 0, shadowCamera: new OrthographicCamera(-4, 4, 4, -4, 0.001, 2) };
  const savedShadowCamera = ground.shadowCamera.clone();
  let renders = 0;
  const poses = [];
  const viewer = {
    scene: { activeCamera, renderCamera: activeCamera }, canvas: { width: 800, height: 800 }, renderEnabled: true,
    getPluginByType: type => type === "Progressive" ? progressive : type === "ContactShadowGroundPlugin" ? ground : undefined, setDirty() {}, dispatchEvent() {},
    renderer: {
      defaultRenderToScreen: true, renderSize: { x: 400, y: 400 }, displayCanvasScaling: 2,
      composer: { readBuffer: {} }, reset() {},
      setSize(width, height) {
        this.renderSize.x = width; this.renderSize.y = height;
        viewer.canvas.width = width * this.displayCanvasScaling;
        viewer.canvas.height = height * this.displayCanvasScaling;
      },
      render(toScreen) {
        assert.equal(toScreen, false, "photo renders never replace the visible canvas");
        assert.equal(viewer.renderEnabled, false);
        assert.equal(viewer.scene.activeCamera, activeCamera);
        assert.notEqual(viewer.scene.renderCamera, activeCamera);
        assert.equal(viewer.canvas.width, preview.RING_PREVIEW_RESOLUTION, "photos are rendered at full resolution rather than enlarged from the gallery tile");
        assert.equal(viewer.canvas.height, preview.RING_PREVIEW_RESOLUTION);
        const stagedBounds = new Box3().setFromObject(root);
        assert.ok(Math.abs(stagedBounds.min.y) < 1e-6, "each product pose rests on its floor");
        assert.ok(ground.shadowCamera.far > stagedBounds.max.y, "the shadow camera includes the entire ring");
        assert.equal(root.children[0].material.userData.renderToDepth, true, "diamonds and metal both contribute to the photo shadow");
        assert.ok(floor.position.y < stagedBounds.min.y);
        assert.equal(ground.enableRefreshTransform, false, "live floor updates cannot overwrite the photo stage");
        assert.notEqual(floor.material, floorMaterial);
        assert.equal(floor.material.map, floorMaterial.alphaMap, "photos use the generated depth shadow, rather than a painted ellipse");
        assert.equal(floor.material.userData.renderToDepth, true, "the floor participates in WebGI's shared depth buffer");
        renders++; poses.push(viewer.scene.renderCamera.cameraObject.position.toArray());
      },
      renderTargetToDataUrl: () => `data:image/png;frame=${renders}`,
    },
  };
  const checkRestored = () => {
    assert.equal(viewer.scene.renderCamera, activeCamera);
    assert.equal(viewer.renderEnabled, true);
    assert.equal(viewer.renderer.defaultRenderToScreen, true);
    assert.equal(progressive.enabled, true);
    assert.deepEqual(viewer.renderer.renderSize, {x: 400, y: 400}, "live rendering resolution is restored after export, cancellation, or errors");
    assert.deepEqual(activeCamera.position.toArray(), [3, 4, 8]);
    assert.deepEqual(activeCamera.target.toArray(), [0, 1, 0]);
    assert.deepEqual(root.position.toArray(), rootPose.position);
    assert.deepEqual(root.quaternion.toArray(), rootPose.quaternion);
    assert.deepEqual(root.scale.toArray(), rootPose.scale);
    assert.equal(root.children[0].material.userData.renderToDepth, undefined);
    assert.deepEqual(floor.position.toArray(), [1, -4, 2]);
    assert.equal(floor.material.opacity, 0.7);
    assert.equal(floor.material, floorMaterial);
    assert.equal(ground.enableRefreshTransform, true);
    assert.equal(ground.blurAmount, 0);
    assert.deepEqual(ground.shadowCamera.projectionMatrix.elements, savedShadowCamera.projectionMatrix.elements);
    assert.deepEqual(ground.shadowCamera.position.toArray(), savedShadowCamera.position.toArray());
  };
  return { viewer, checkRestored, poses, count: () => renders };
};

const complete = makeViewer();
const photos = await preview.captureRingPreviews(complete.viewer, [root], new AbortController().signal);
assert.deepEqual(photos.map(item => item.id), ["three-quarter", "top", "profile"]);
assert.equal(new Set(photos.map(item => item.url)).size, 3);
assert.equal(new Set(complete.poses.map(position => JSON.stringify(position))).size, 3);
assert.ok(flips.every(args => args[0] === 1 && args[1] === -1), "readback images are correctly oriented");
complete.checkRestored();

const cancelled = makeViewer();
const controller = new AbortController();
onDecode = () => controller.abort();
await assert.rejects(preview.captureRingPreviews(cancelled.viewer, [root], controller.signal), error => error.name === "AbortError");
assert.equal(cancelled.count(), 2, "a new selection stops stale photo rendering immediately");
cancelled.checkRestored();
onDecode = undefined;

const failed = makeViewer();
failed.viewer.renderer.renderTargetToDataUrl = () => { throw new Error("readback failed"); };
await assert.rejects(preview.captureRingPreviews(failed.viewer, [root], new AbortController().signal), /readback failed/);
failed.checkRestored();

// Imported assemblies can be under transformed WebGI scene parents.
const parent = new Group();
parent.position.set(2, 3, -4);
parent.rotation.set(0.1, -0.3, 0.2);
parent.scale.setScalar(1.2);
parent.add(root);
const stage = preview.createRingPhotoStage([root]);
for (const view of preview.RING_PREVIEW_VIEWS) {
  const staged = stage.pose(view.lying);
  assert.ok(Math.abs(staged.min.y) < 1e-6);
  const head = new Vector3(0, 0, 2.5).applyMatrix4(root.matrixWorld);
  const bottom = new Vector3(0, 0, -2.5).applyMatrix4(root.matrixWorld);
  if (view.lying) {
    assert.ok(head.x > bottom.x && Math.abs(head.y - bottom.y) < 1e-6, "the laid-flat ring keeps its head on the right");
  } else assert.ok(head.y > bottom.y, "the three-quarter photo keeps the ring upright");
}
stage.restore();
assert.deepEqual(root.position.toArray(), rootPose.position);
assert.deepEqual(root.quaternion.toArray(), rootPose.quaternion);
assert.deepEqual(root.scale.toArray(), rootPose.scale);

const headRoot = new Group();
const headMesh = new Mesh(new BoxGeometry(1.4, 1.3, 0.6), new MeshBasicMaterial());
headMesh.position.z = 1.6;
headRoot.add(headMesh);
const bandRoot = new Group();
bandRoot.add(new Mesh(new BoxGeometry(2.8, 0.2, 2.5), new MeshBasicMaterial()));
const restingStage = preview.createRingPhotoStage([headRoot, bandRoot]);
restingStage.pose(true);
const headFloor = new Box3().setFromObject(headRoot).min.y;
const bandFloor = new Box3().setFromObject(bandRoot).min.y;
assert.ok(Math.abs(headFloor - bandFloor) < 1e-6, "both the front head and back band touch the ground");
restingStage.restore();
assert.deepEqual(headRoot.position.toArray(), [0, 0, 0]);
assert.deepEqual(bandRoot.position.toArray(), [0, 0, 0]);

// Curved geometry exposes the false contact points produced by transformed boxes.
for (const [headRadius, bandThickness] of [[0.25, 0.12], [0.8, 0.12], [0.2, 0.35]]) {
  const curvedHead = new Group(), curvedBand = new Group();
  const stone = new Mesh(new SphereGeometry(headRadius, 24, 20), new MeshBasicMaterial());
  stone.position.z = 1.7;
  curvedHead.add(stone);
  const torus = new Mesh(new TorusGeometry(1.2, bandThickness, 20, 64), new MeshBasicMaterial());
  torus.rotation.x = Math.PI / 2;
  curvedBand.add(torus);
  const curvedStage = preview.createRingPhotoStage([curvedHead, curvedBand]);
  curvedStage.pose(true);
  const headBottom = new Box3().setFromObject(curvedHead, true).min.y;
  const backBottom = new Box3().setFromObject(curvedBand, true).min.y;
  assert.ok(Math.abs(headBottom) < 1e-6 && Math.abs(backBottom) < 1e-6, "both curved surfaces meet the ground, including narrow heads and thick bands");
  curvedStage.restore();
}
console.log("Gallery checks passed: framing, photo poses, depth shadows, parent transforms, live pose restoration, cancellation, and error recovery.");
