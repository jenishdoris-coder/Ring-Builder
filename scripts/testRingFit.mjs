import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshPhysicalMaterial, PerspectiveCamera, TorusGeometry, Vector3 } from "three";

const directory = await mkdtemp(join(tmpdir(), "ring-fit-")), emitted = new Map();
const mock = join(directory, "webgi.mjs");
await writeFile(mock, `export * from ${JSON.stringify(pathToFileURL(resolve("node_modules/three/build/three.module.js")).href)}; export class AssetManagerPlugin {} export class SSRPlugin {}`);
const emit = async path => {
  if (emitted.has(path)) return emitted.get(path);
  const output = join(directory, `${emitted.size}.mjs`); emitted.set(path, output);
  const source = await readFile(path, "utf8");
  if (path.endsWith(".json")) { await writeFile(output, `export default ${source};`); return output; }
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll("import.meta.env.DEV", "true");
  for (const match of [...code.matchAll(/from\s+["']([^"']+)["']/g)]) {
    const specifier = match[1];
    const dependency = specifier === "webgi" ? mock : specifier.startsWith(".") ? await emit(resolve(dirname(path), specifier.endsWith(".json") ? specifier : `${specifier}.ts`)) : null;
    if (dependency) code = code.replace(match[0], `from ${JSON.stringify(pathToFileURL(dependency).href)}`);
  }
  await writeFile(output, code); return output;
};
try {
  const { measureRingBore } = await import(pathToFileURL(await emit(resolve("src/utils/ringBore.ts"))).href);
  const { HandPreview } = await import(pathToFileURL(await emit(resolve("src/utils/handPreview.ts"))).href);
  const calibration = JSON.parse(await readFile("src/config/handPreview.json", "utf8"));
  const makeBand = width => {
    const geometry = new TorusGeometry(9.5, .85, 12, 128);
    geometry.rotateX(Math.PI / 2);
    // Stretch the axial section to include multi-row widths without changing its bore.
    geometry.scale(1, width / .85, 1);
    const root = new Group(); root.add(new Mesh(geometry, new MeshPhysicalMaterial()));
    root.position.set(1, -.35, 2); root.rotation.set(Math.PI / 2, Math.PI, -1.22); root.scale.setScalar(.119);
    return root;
  };
  const narrow = makeBand(1.2), measured = measureRingBore(narrow);
  assert.ok(Math.abs(measured.radius - 8.65) < .03);
  const outer = new TorusGeometry(12, 1, 48, 512); outer.rotateX(Math.PI / 2);
  narrow.add(new Mesh(outer, new MeshPhysicalMaterial()));
  assert.ok(Math.abs(measureRingBore(narrow).radius - measured.radius) < .001, "dense outer decorations cannot enlarge the finger through the shank");

  // Use the actual textured hand geometry to check the fitted skin at the band.
  const glb = await readFile("public/models/hand/female_hand.glb");
  const jsonLength = glb.readUInt32LE(12), gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const accessor = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION], view = gltf.bufferViews[accessor.bufferView];
  const dataOffset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const positions = Array.from({ length: accessor.count * 3 }, (_, i) => glb.readFloatLE(dataOffset + Math.floor(i / 3) * (view.byteStride ?? 12) + i % 3 * 4));
  const geometry = new BufferGeometry();
  const interleaved = new Float32Array(accessor.count * 8);
  for (let i = 0; i < accessor.count; i++) interleaved.set([...positions.slice(i * 3, i * 3 + 3), 0, 1, 0, .5, .5], i * 8);
  geometry.setAttribute("position", new InterleavedBufferAttribute(new InterleavedBuffer(interleaved, 8), 3, 0));
  const skin = new MeshPhysicalMaterial(), handMesh = new Mesh(geometry, skin), source = new Group(); source.rotation.x = -Math.PI / 2; source.add(handMesh);
  const scene = new Group(), viewer = { scene, setDirty() {}, getPluginByType() {} };
  const cameraObject = new PerspectiveCamera(45, 1, .01, 1000); cameraObject.position.set(0, 3, 35); cameraObject.lookAt(0, 0, 0);
  const activeCamera = { cameraObject, near: .01, far: 1000 };
  scene.activeCamera = scene.renderCamera = activeCamera;
  const hand = new HandPreview(viewer, { importer: { importPath: async () => source } });
  await hand.load();
  assert.equal(skin.userData.renderToDepth, true, "hand depth agrees with the ring's opaque/diamond passes");
  const axis = new Vector3(...calibration.ringFinger.axis).normalize(), dorsal = new Vector3(...calibration.ringFinger.dorsal).normalize();
  const lateral = new Vector3().crossVectors(axis, dorsal).normalize(), anchor = new Vector3(...calibration.ringFinger.anchor);
  for (const width of [1.2, 3]) {
    const band = makeBand(width); scene.add(band); band.updateWorldMatrix(true, true); const saved = band.matrix.clone();
    hand.show(band); band.updateWorldMatrix(true, true);
    const inverse = band.matrixWorld.clone().invert(), bore = measureRingBore(band), scale = bore.radius * .119 / calibration.ringFinger.radius * calibration.ringFinger.clearance;
    const halfWidthOnHand = bore.halfWidth * .119 / scale, offset = Math.min(.65, Math.max(.08, halfWidthOnHand - .12));
    const seat = anchor.clone().addScaledVector(axis, offset), fittedSeat = seat.clone().applyMatrix4(handMesh.matrixWorld).applyMatrix4(inverse);
    assert.ok(fittedSeat.length() < 1e-6, "the finger seat stays at the centre of the bore");
    let checked = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const point = new Vector3().fromBufferAttribute(handMesh.geometry.attributes.position, i / 3), relative = point.clone().sub(seat);
      if (Math.abs(relative.dot(axis)) > halfWidthOnHand || Math.abs(relative.dot(lateral)) > 1 || Math.abs(relative.dot(dorsal)) > 1) continue;
      point.applyMatrix4(handMesh.matrixWorld).applyMatrix4(inverse);
      const radius = Math.hypot(point.x, point.z);
      assert.ok(radius < bore.radius, "skin at the fitted band cannot bury its metal surface");
      assert.ok(radius > bore.radius * .993, "contact cannot leave a visible air gap under the band"); checked++;
    }
    assert.ok(checked > 4, "checked actual ring-finger skin vertices");
    hand.updateDepthRange();
    assert.ok(activeCamera.near > .1 && activeCamera.far < 1000, "hand mode uses a bounded depth interval instead of the scene-wide range");
    assert.equal(cameraObject.userData.autoNearFar, false);
    const pose = hand.root.matrixWorld.clone(); hand.suspend();
    assert.equal(cameraObject.userData.autoNearFar, undefined, "photo captures restore automatic camera clipping");
    assert.equal(activeCamera.far, 1000);
    hand.resume(band);
    assert.ok(hand.root.matrixWorld.elements.every((v, i) => Math.abs(v - pose.elements[i]) < 1e-8), "photo capture cannot accumulate a seating offset");
    assert.equal(band.visible, true); assert.deepEqual(band.matrix.elements, saved.elements, "seating never changes the band pose");
    scene.remove(band);
  }
  hand.dispose();
  console.log("Ring fit checks passed: tessellation-independent bore, narrow/wide band skin clearance, depth participation, and capture resume.");
} finally {
  for (const file of [...emitted.values(), mock]) await unlink(file);
  await rmdir(directory);
}
