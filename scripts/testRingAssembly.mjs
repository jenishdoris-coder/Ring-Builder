import assert from "node:assert/strict";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from "three";

const tempDirectory = await mkdtemp(join(tmpdir(), "ring-assembly-test-"));
const emitted = new Map();
const mockPath = join(tempDirectory, "webgi.mjs");
await writeFile(mockPath, `export * from ${JSON.stringify(pathToFileURL(resolve("node_modules/three/build/three.module.js")).href)}; export class AssetManagerPlugin {} export class SSRPlugin {}`);
const emitModule = async (sourcePath) => {
  if (emitted.has(sourcePath)) return emitted.get(sourcePath);
  const outputPath = join(tempDirectory, `${emitted.size}.mjs`);
  emitted.set(sourcePath, outputPath);
  const source = await readFile(sourcePath, "utf8");
  if (sourcePath.endsWith(".json")) {
    await writeFile(outputPath, `export default ${source};`);
    return outputPath;
  }
  let output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const match of [...output.matchAll(/from\s+["']([^"']+)["']/g)]) {
    const specifier = match[1];
    let dependency;
    if (specifier === "webgi") dependency = mockPath;
    else if (specifier.startsWith(".")) dependency = await emitModule(resolve(dirname(sourcePath), specifier.endsWith(".json") ? specifier : `${specifier}.ts`));
    else continue;
    output = output.replace(match[0], `from ${JSON.stringify(pathToFileURL(dependency).href)}`);
  }
  await writeFile(outputPath, output);
  return outputPath;
};

try {
  const { alignRingHeadToShank } = await import(pathToFileURL(await emitModule(resolve("src/utils/ringAssembly.ts"))).href);
  const { ensurePartMeshesCached } = await import(pathToFileURL(await emitModule(resolve("src/utils/partLoader.ts"))).href);
  const { createContactShadowFade } = await import(pathToFileURL(await emitModule(resolve("src/utils/sceneUtils.ts"))).href);
  const shadowMaterial = { opacity: 0.7 };
  const shadowMesh = { visible: true };
  const fadeShadow = createContactShadowFade({ material: shadowMaterial, mesh: { modelObject: shadowMesh } });
  fadeShadow(0.5);
  assert.equal(shadowMaterial.opacity, 0.175);
  fadeShadow(0);
  assert.equal(shadowMaterial.opacity, 0);
  assert.equal(shadowMesh.visible, false, "the shadow plane disappears at the swap");
  fadeShadow(1);
  assert.equal(shadowMaterial.opacity, 0.7, "original shadow opacity is restored");
  assert.equal(shadowMesh.visible, true);
  createContactShadowFade(null)(0);
  const makeMesh = (x, y, z, width, height, depth, diamond = false) => {
    const material = new MeshPhysicalMaterial();
    material.name = diamond ? "Gem 03" : "Metal 01";
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    mesh.name = diamond ? "Diamond_Round" : "Metal";
    mesh.position.set(x, y, z);
    return mesh;
  };
  const makePair = (seatHeight, headBase, headScale = 1) => {
    const head = new Group();
    const shank = new Group();
    head.add(makeMesh(0, 0, headBase + 1, 1, 1, 2));
    head.add(makeMesh(0, 0, headBase + 4, 2, 2, 2, true));
    shank.add(makeMesh(0, 0, seatHeight - 0.5, 20, 2, 1));
    shank.add(makeMesh(0, 0, -10, 20, 2, 1));
    // Diamonds and high shoulders must not be mistaken for the center seat.
    shank.add(makeMesh(0, 0, seatHeight + 4, 1, 1, 2, true));
    shank.add(makeMesh(8, 0, seatHeight + 2, 1, 2, 2));
    for (const root of [head, shank]) {
      root.position.set(1, -0.35, 2);
      root.rotation.set(Math.PI / 2, Math.PI, -1.22);
      root.scale.setScalar(0.119);
    }
    head.scale.multiplyScalar(headScale);
    return { head, shank };
  };
  for (const [seatHeight, base, scale] of [[9.4, 11.2, 1], [10.5, 9.4, 1], [12.1, 9.4, 0.8], [9.4, 12, 1.4]]) {
    const { head, shank } = makePair(seatHeight, base, scale);
    const rootPosition = head.position.clone();
    const geometry = Array.from(head.children[0].geometry.attributes.position.array);
    const assembly = alignRingHeadToShank(head, shank);
    assert.ok(assembly);
    assert.ok(Math.abs(assembly.seatZ - seatHeight) < 1e-8, `finds the center metal seat: ${JSON.stringify(assembly)}`);
    assert.ok(Math.abs(assembly.baseZ - (seatHeight - assembly.overlap)) < 1e-8, "no gap at the head base");
    const mount = head.__headMountGroup;
    const originalOffset = mount.position.z;
    const diamondPosition = mount.children[1].position.clone();
    alignRingHeadToShank(head, shank);
    assert.ok(Math.abs(mount.position.z - originalOffset) < 1e-8, "alignment does not accumulate");
    assert.equal(head.children.length, 1);
    assert.deepEqual(head.position, rootPosition, "does not change the user's ring pose");
    assert.deepEqual(mount.children[1].position, diamondPosition, "gem and prongs stay assembled");
    assert.deepEqual(Array.from(mount.children[0].geometry.attributes.position.array), geometry);
    for (const root of [head, shank]) {
      root.rotation.set(0.3, 0.9, -0.6);
      root.position.add(new Vector3(3, 5, -2));
      root.scale.multiplyScalar(2);
    }
    const transformed = alignRingHeadToShank(head, shank);
    assert.ok(Math.abs(transformed.offsetZ - originalOffset) < 1e-8, "mounting is independent of world rotation and scale");
  }
  assert.equal(alignRingHeadToShank(null, new Group()), null);

  // Import models off-scene: embedded viewer configs must never reach addFromPath.
  const caches = { head: new Map(), shank: new Map(), band: new Map() };
  const inFlight = { current: new Map() };
  let imports = 0;
  let addFromPathCalls = 0;
  const pose = { position: [3, 7, -5], target: [1, 0.4, 0], zoom: 2 };
  const originalPose = structuredClone(pose);
  const manager = {
    importer: { importPath: async () => {
      imports++;
      const modelObject = new Group();
      modelObject.__importedViewerConfig = { camera: { position: [7.5, 3.8, -7.5] } };
      modelObject.add(makeMesh(0, 0, 10, 1, 1, 2));
      return [{ modelObject, dispose: () => {} }];
    } },
    addFromPath: () => { addFromPathCalls++; pose.position = [7.5, 3.8, -7.5]; throw new Error("must not add a part's source scene"); },
  };
  const viewer = { getManager: () => manager, getPluginByType: () => null };
  const cached = await ensurePartMeshesCached(viewer, "head", "/test.glb", caches, inFlight);
  assert.equal(cached, true);
  assert.equal(imports, 1);
  assert.equal(addFromPathCalls, 0);
  assert.deepEqual(pose, originalPose, "importing an uncached part preserves camera angle, pan, and zoom");
  assert.equal(caches.head.get("/test.glb").length, 1);
  await ensurePartMeshesCached(viewer, "head", "/test.glb", caches, inFlight);
  assert.equal(imports, 1, "cached switches do not reimport the model");
  assert.equal(inFlight.current.size, 0);
  console.log("Assembly checks passed: mounting gaps, variant scales, live transforms, diamond alignment, and camera-safe imports.");
} finally {
  await Promise.all([...emitted.values(), mockPath].map(path => unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; })));
  await rmdir(tempDirectory);
}
