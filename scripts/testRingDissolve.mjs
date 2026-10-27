import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { BoxGeometry, Group, Matrix4, Mesh, MeshPhysicalMaterial, Vector3 } from "three";

// Use the same Three.js primitives as WebGI without booting a WebGL viewer.
const source = await readFile(new URL("../src/utils/ringDissolve.ts", import.meta.url), "utf8");
const moduleSource = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
  .replace('"webgi"', JSON.stringify(pathToFileURL(resolve("node_modules/three/build/three.module.js")).href))
  .replace('"../config/animationConfig"', JSON.stringify(new URL("../src/config/animationConfig.ts", import.meta.url).href));
const tempModulePath = join(tmpdir(), `ring-dissolve-${randomUUID()}.mjs`);
const loadTestModule = async (query = "") => {
  await writeFile(tempModulePath, moduleSource);
  try { return await import(`${pathToFileURL(tempModulePath).href}${query}`); }
  finally { await unlink(tempModulePath); }
};
const { animateRingDissolve, prepareRingDissolve } = await loadTestModule();

let nextFrameId = 0;
const frames = new Map();
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++nextFrameId, callback);
  return nextFrameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const stepOneFrame = (time) => {
  const scheduled = [...frames.values()];
  frames.clear();
  scheduled.forEach((callback) => callback(time));
};
let lastStep = 0;
const step = (time) => {
  for (let frameTime = lastStep + 16; frameTime < time; frameTime += 16) stepOneFrame(frameTime);
  stepOneFrame(time);
  lastStep = time;
};
const makeMaterial = () => {
  const material = new MeshPhysicalMaterial({ metalness: 1, roughness: 0.08 });
  material.materialExtensions = [];
  material.registerMaterialExtensions = (extensions) => material.materialExtensions.push(...extensions);
  return material;
};
const makePart = () => {
  const root = new Group();
  root.position.set(2, -0.35, 1);
  root.rotation.set(Math.PI / 2, Math.PI, -1.22);
  root.scale.setScalar(0.119);
  const mesh = new Mesh(new BoxGeometry(4, 1, 6), makeMaterial());
  mesh.position.set(1, 2, 3);
  const diamond = new Mesh(new BoxGeometry(1, 1, 1), makeMaterial());
  diamond.position.set(1, 4, 3);
  diamond.material.isDiamondMaterial = true;
  root.add(mesh, diamond);
  root.updateWorldMatrix(true, true);
  return { root, mesh, diamond };
};
const oldPart = makePart();
const newPart = makePart();
const unchangedPart = makePart();
const depthMaterial = makeMaterial();
const beforePosition = oldPart.mesh.position.clone();
const beforeGeometry = Array.from(oldPart.mesh.geometry.attributes.position.array);
const oldState = prepareRingDissolve(oldPart.root);
const newState = prepareRingDissolve(newPart.root);
const phaseChanges = [];
let shadowVisibility = 1;
let swaps = 0;
const play = (extra = {}) => animateRingDissolve({
  outgoing: [oldPart.root],
  incoming: [newPart.root],
  depthMaterial,
  onSwap: () => { swaps++; },
  onUpdate: () => {},
  onVisibilityChange: (visibility) => { shadowVisibility = visibility; },
  onPhaseChange: (phase) => phaseChanges.push(phase),
  ...extra,
});

const transition = play();
step(0);
step(310);
assert.equal(oldState.progress.value, 0.5, "old part dissolves halfway before the swap");
assert.equal(shadowVisibility, 0.5, "the shadow fades with the outgoing ring");
assert.equal(newState.progress.value, 1, "replacement is fully hidden before the swap");
assert.equal(swaps, 0);
step(620);
assert.equal(oldState.progress.value, 1, "old surfaces disappear completely");
assert.equal(shadowVisibility, 0, "no shadow remains when the ring disappears");
step(680);
assert.equal(swaps, 1, "swap happens exactly once in the hidden interval");
step(1090);
assert.ok(Math.abs(newState.progress.value - 0.5) < 1e-9, "new part rebuilds progressively");
assert.ok(Math.abs(shadowVisibility - 0.5) < 1e-9, "shadow returns with the new ring");
step(1500);
assert.equal(await transition.finished, true);
assert.equal(oldState.progress.value, 0);
assert.equal(newState.progress.value, 0);
assert.equal(shadowVisibility, 1, "the completed ring has its full shadow");
assert.deepEqual(phaseChanges, ["dissolving", "revealing"]);
assert.equal(frames.size, 0);
assert.deepEqual(oldPart.mesh.position, beforePosition, "dissolve preserves alignment");
assert.deepEqual(Array.from(oldPart.mesh.geometry.attributes.position.array), beforeGeometry);
assert.equal(oldPart.mesh.material.roughness, 0.08);
assert.equal(unchangedPart.mesh.material.materialExtensions.length, 0, "unchanged part is untouched");

// Metal and diamond use the same spatial field, including after a diamond rebake.
assert.equal(oldPart.mesh.material.materialExtensions[0].extraUniforms.uRingDissolveProgress, oldState.progress);
assert.equal(oldPart.diamond.material.materialExtensions[0].extraUniforms.uRingDissolveProgress, oldState.progress);
oldPart.diamond.material = makeMaterial();
prepareRingDissolve(oldPart.root);
assert.equal(oldPart.diamond.material.materialExtensions.length, 1, "rebaked materials receive dissolve");
prepareRingDissolve(oldPart.root);
assert.equal(oldPart.mesh.material.materialExtensions.length, 1, "repeated preparation is idempotent");

// Shader injection supports standard and custom diamond shader main formatting.
for (const main of ["void main() {", "void main ()\n{"]) {
  const shader = { vertexShader: `${main} gl_Position = vec4(position, 1.0); }`, fragmentShader: `${main} gl_FragColor = vec4(1.0); }`, uniforms: {} };
  oldPart.mesh.material.materialExtensions[0].shaderExtender(shader);
  oldPart.mesh.material.materialExtensions[0].shaderExtender(shader);
  assert.match(shader.vertexShader, /vRingDissolvePosition =/);
  assert.match(shader.fragmentShader, /discard;/);
  assert.equal(shader.fragmentShader.match(/uniform float uRingDissolveProgress;/g).length, 1);
}

// The depth pass follows the current mesh and resets for unrelated objects.
const depthExtension = depthMaterial.materialExtensions[0];
oldState.progress.value = 0.6;
depthExtension.onObjectRender(oldPart.mesh);
assert.equal(depthExtension.extraUniforms.uRingDissolveProgress.value, 0.6);
depthExtension.onObjectRender(unchangedPart.mesh);
assert.equal(depthExtension.extraUniforms.uRingDissolveProgress.value, 0);
oldState.progress.value = 0;

// The noise stays anchored to the model after rotation, translation, and scaling.
oldPart.root.position.add(new Vector3(3, 4, 5));
oldPart.root.scale.setScalar(0.3);
oldPart.root.updateWorldMatrix(true, true);
oldPart.mesh.material.materialExtensions[0].onObjectRender();
const expected = new Matrix4().multiplyMatrices(oldState.normalization, oldPart.root.matrixWorld.clone().invert());
assert.deepEqual(oldState.worldToPattern.value.elements, expected.elements);

for (const cancelAfterSwap of [false, true]) {
  const active = play();
  step(0);
  step(cancelAfterSwap ? 900 : 310);
  const swapCount = swaps;
  active.cancel();
  active.cancel();
  assert.equal(await active.finished, false);
  assert.equal(oldState.progress.value, 0);
  assert.equal(newState.progress.value, 0);
  assert.equal(shadowVisibility, 1, "interruption restores the shadow");
  step(5000);
  assert.equal(swaps, swapCount, "a cancelled transition cannot commit later");
  assert.equal(frames.size, 0);
}
assert.equal(depthMaterial.materialExtensions.length, 1, "depth extension is installed once");

const reduced = play({ reducedMotion: true });
step(0);
step(140);
assert.equal(oldState.progress.value, 0.5, "reduced motion keeps a shorter stationary dissolve instead of an instant swap");
step(310);
step(490);
assert.ok(Math.abs(newState.progress.value - 0.5) < 1e-9, "the reduced-motion reveal remains visible");
step(680);
assert.equal(await reduced.finished, true);
assert.equal(shadowVisibility, 1);
assert.equal(frames.size, 0, "the shorter reduced-motion transition completes");

const slowLaptop = play();
stepOneFrame(0);
stepOneFrame(1800);
assert.ok(oldState.progress.value > 0 && oldState.progress.value < 0.1, "a long frame cannot skip the outgoing dissolve");
assert.equal(newState.progress.value, 1, "the incoming ring stays hidden during a delayed outgoing frame");
for (let time = 1816; time <= 2440; time += 16) stepOneFrame(time);
stepOneFrame(5000);
assert.ok(newState.progress.value > 0.8, "shader stalls at the swap cannot skip the incoming reveal");
for (let time = 5016; time <= 5900; time += 16) stepOneFrame(time);
assert.equal(await slowLaptop.finished, true);
assert.equal(frames.size, 0);

// The unchanged head/shank must dissolve and reveal with the changed part.
const sharedState = prepareRingDissolve(unchangedPart.root);
const wholeRing = play({
  outgoing: [oldPart.root, unchangedPart.root],
  incoming: [newPart.root, unchangedPart.root],
});
assert.equal(sharedState.progress.value, 0, "shared ring parts start fully visible");
step(0);
step(310);
assert.equal(sharedState.progress.value, oldState.progress.value);
step(680);
assert.equal(sharedState.progress.value, 1, "the whole ring is hidden at the swap");
step(1090);
assert.equal(sharedState.progress.value, newState.progress.value);
wholeRing.cancel();
assert.equal(await wholeRing.finished, false);
assert.equal(sharedState.progress.value, 0, "interruption restores unchanged parts too");

const failed = play({ onSwap: () => { throw new Error("swap failed"); } });
step(0);
step(700);
await assert.rejects(failed.finished, /swap failed/);
assert.equal(oldState.progress.value, 0, "errors restore a complete visible model");
assert.equal(newState.progress.value, 0);
assert.equal(frames.size, 0);
assert.equal(shadowVisibility, 1, "a failed swap restores the shadow");

const reloaded = await loadTestModule("?hot-reload");
const reloadedTransition = reloaded.animateRingDissolve({
  outgoing: [oldPart.root], incoming: [newPart.root], depthMaterial,
  onSwap: () => {}, onUpdate: () => {},
});
assert.equal(oldPart.mesh.material.materialExtensions.length, 1, "hot reload reuses the material extension");
assert.equal(depthMaterial.materialExtensions.length, 1, "hot reload reuses the depth extension");
reloadedTransition.cancel();
assert.equal(await reloadedTransition.finished, false);
console.log("Ring dissolve checks passed: shaders, depth, transforms, completion, rebakes, cancellation, errors, and reduced motion.");
