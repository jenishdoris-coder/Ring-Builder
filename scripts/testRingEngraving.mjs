import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, TorusGeometry, Vector3 } from "three";

// Run the actual renderer and geometry queries with Three's CPU math. Only the
// browser canvas and WebGI's material-registration API need test substitutes.
const threeUrl = pathToFileURL(resolve("node_modules/three/build/three.module.js")).href;
const bundle = await build({
  stdin: { contents: 'export * from "./src/utils/ringEngraving"; export * from "./src/config/engraving";', resolveDir: resolve("."), loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false, define: { "import.meta.env": "{}" },
  plugins: [{ name: "webgi-cpu-math", setup(builder) { builder.onResolve({ filter: /^webgi$/ }, () => ({ path: threeUrl, external: true })); } }],
});
const { RingEngraving, MultiRingEngraving, ENGRAVING_POSITIONS, engravingTextError, normalizeEngravingText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
let masks = 0;
globalThis.document = { createElement: () => {
  masks++;
  return { width: 0, height: 0, getContext: () => ({ measureText: text => ({ width: Array.from(text).length * 100, actualBoundingBoxAscent: 140, actualBoundingBoxDescent: 35 }), fillText() {} }) };
} };
assert.equal(normalizeEngravingText("  Love\n always  "), "Love always");
assert.ok(engravingTextError("  "));
assert.ok(engravingTextError("x".repeat(25)));
assert.equal(engravingTextError("♥".repeat(24)), "");

const prepareMaterials = root => root.traverse(mesh => {
  if (!mesh.isMesh) return;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    material.materialExtensions ??= [];
    material.registerMaterialExtensions = items => material.materialExtensions.push(...items);
    material.unregisterMaterialExtensions = items => { material.materialExtensions = material.materialExtensions.filter(item => !items.includes(item)); };
  }
});
const root = new Group();
const metal = new MeshStandardMaterial();
const band = new Mesh(new TorusGeometry(10, 1, 32, 128), metal);
band.rotation.x = Math.PI / 2;
root.add(band);
root.position.set(2, -.35, 1);
root.rotation.set(Math.PI / 2, Math.PI, -1.22);
root.scale.setScalar(.119);
prepareMaterials(root);
const renderer = new RingEngraving();
const camera = new PerspectiveCamera(25, 1);
for (const position of ENGRAVING_POSITIONS) {
  assert.equal(renderer.apply(root, { text: "Forever", position: position.id }), "ready", `${position.id} supports engraving under the live ring transform`);
  assert.equal(metal.materialExtensions.length, 1, "updates replace the existing material extension");
  const extension = metal.materialExtensions[0];
  const layout = extension.extraUniforms.uRingEngravingLayout.value;
  const surface = extension.extraUniforms.uRingEngravingSurface.value;
  assert.ok(surface.x > 8.9 && surface.x < 9.1, "text uses the inner radius, not the outside wall");
  assert.equal(layout.x, position.angle);
  assert.ok(Math.abs(layout.w) < .01 && layout.z > 0 && layout.z < 2, "text fits inside the band width");
  extension.onObjectRender(band);
  const pose = renderer.cameraPose(camera);
  assert.ok(pose && pose.position.distanceTo(pose.target) > 0);
  const localTarget = pose.target.clone().applyMatrix4(root.matrixWorld.clone().invert());
  assert.ok(localTarget.dot(new Vector3(Math.sin(position.angle), 0, -Math.cos(position.angle))) > 0, "focus favours the selected wall while retaining the complete band in frame");
  const revision = renderer.revision, count = masks;
  assert.equal(renderer.apply(root, { text: "Forever", position: position.id }), "ready", `${position.id} supports engraving under the live ring transform`);
  assert.equal(renderer.revision, revision);
  assert.equal(masks, count, "unchanged inscriptions reuse their mask and surface queries");
}
const oldExtension = metal.materialExtensions[0];
assert.equal(renderer.apply(root, null), "idle");
assert.equal(renderer.active, false);
assert.equal(oldExtension.extraUniforms.uRingEngravingSurface.value.w, 0, "removal disables the inscription on the live material");
assert.equal(renderer.cameraPose(camera), undefined);
assert.equal(renderer.apply(new Group(), { text: "Forever", position: "bottom" }), "unavailable", "missing surfaces fail without floating text");
renderer.dispose();

const multi = new MultiRingEngraving();
const inscriptions = [{ position: "bottom", text: "Forever" }, { position: "left", text: "Love" }, { position: "right", text: "26.10.2026" }];
assert.equal(multi.apply(root, inscriptions), "ready");
const channels = metal.materialExtensions.filter(item => /ring-inner-engraving-v1.+/.test(item.customCacheKey));
assert.equal(channels.length, 3, "all three inscriptions coexist on the same material");
const shader = { vertexShader: "void main() { }", fragmentShader: "void main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}" };
channels.forEach(extension => extension.shaderExtender(shader));
assert.equal((shader.fragmentShader.match(/void main/g) ?? []).length, 1);
for (const { position } of inscriptions) {
  assert.ok(shader.fragmentShader.includes(`ringEngravingCoverage${position}()`));
  assert.ok(channels.some(extension => extension.extraUniforms[`uRingEngravingMask${position}`]));
  assert.ok(multi.cameraPose(camera, position));
}
const revision = multi.revision;
multi.apply(root, inscriptions);
assert.equal(multi.revision, revision, "view changes do not rebuild any inscription");
multi.apply(root, [inscriptions[0]]);
assert.ok(multi.cameraPose(camera, "bottom"));
assert.equal(multi.cameraPose(camera, "left"), undefined, "disabling multiple positions removes the other marks");
multi.dispose();

// Real catalog geometry catches incompatible axes, CAD hierarchy changes, and
// hollow/open shoulder positions that a synthetic torus cannot represent.
const catalog = JSON.parse(await readFile("src/config/catalog.json", "utf8"));
const loader = new GLTFLoader();
const decoderModule = { exports: {} };
runInNewContext(await readFile("node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js", "utf8"), { module: decoderModule, exports: decoderModule.exports, console, performance, setTimeout, clearTimeout });
const draco = await decoderModule.exports({});
loader.setDRACOLoader({ preload() {}, decodeDracoFile(buffer, onLoad, attributes, _types, _space, onError) {
  const decoder = new draco.Decoder(), compressed = new draco.DecoderBuffer(), mesh = new draco.Mesh();
  try {
    const bytes = new Int8Array(buffer);
    compressed.Init(bytes, bytes.length);
    const status = decoder.DecodeBufferToMesh(compressed, mesh);
    if (!status.ok()) throw new Error(status.error_msg());
    const geometry = new BufferGeometry();
    for (const [name, id] of Object.entries(attributes)) {
      const attribute = decoder.GetAttributeByUniqueId(mesh, id), values = new draco.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(mesh, attribute, values);
      const array = Float32Array.from({ length: values.size() }, (_, index) => values.GetValue(index));
      geometry.setAttribute(name, new BufferAttribute(array, attribute.num_components()));
      draco.destroy(values);
    }
    const face = new draco.DracoInt32Array(), indices = new Uint32Array(mesh.num_faces() * 3);
    for (let index = 0; index < mesh.num_faces(); index++) {
      decoder.GetFaceFromMesh(mesh, index, face);
      for (let vertex = 0; vertex < 3; vertex++) indices[index * 3 + vertex] = face.GetValue(vertex);
    }
    draco.destroy(face);
    geometry.setIndex(new BufferAttribute(indices, 1));
    onLoad(geometry);
  } catch (error) { onError(error); }
  finally { draco.destroy(mesh); draco.destroy(compressed); draco.destroy(decoder); }
} });
let supported = 0;
for (const shank of catalog.shanks) {
  const file = resolve("public", shank.file.replace(/^\//, ""));
  let bytes;
  try { bytes = await readFile(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  const model = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  // The app extracts each imported mesh into its own part container, discarding
  // the glTF viewer/root conversion matrix. Reproduce that display hierarchy.
  const displayed = new Group();
  model.scene.traverse(mesh => { if (mesh.isMesh) displayed.add(mesh.clone()); });
  prepareMaterials(displayed);
  const engraving = new RingEngraving();
  for (const position of ENGRAVING_POSITIONS) {
    const status = engraving.apply(displayed, { text: "Always & Forever", position: position.id });
    assert.equal(status, "ready", `${shank.name}: ${position.id} supports an inside inscription`);
    const pose = engraving.cameraPose(camera);
    assert.ok(pose?.position.toArray().every(Number.isFinite));
    supported++;
  }
  engraving.dispose();
}
assert.ok(supported >= 60, "verify at least twenty local catalog shanks in all three positions");
console.log(`Engraving checks passed: validation, inner surfaces, position changes, transformed focus, mask reuse, removal, and ${supported} catalog positions.`);







