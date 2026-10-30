import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { alignRingHeadToShank } from "./ring-assembly.ts";
import { isDiamondMesh } from "./ring-meshes.ts";

export interface SelectedRing {
  head: string; band: string; headScale: number; bandScale: number;
  headMetal: string; bandMetal: string; label: string;
}
const asset = (value: string | null, origin: string) => {
  if (!value) throw new Error("Choose a ring in the builder before starting AR.");
  const url = new URL(value, origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      !(url.origin === origin || url.hostname === "pub-00106ed3cef7494fa78a2ebcaedec282.r2.dev")) throw new Error("The ring asset address is not allowed.");
  return url.href;
};
export function readSelectedRing(search = location.search, origin = location.origin): SelectedRing | null {
  const params = new URLSearchParams(search);
  if (!params.has("head") && !params.has("band")) return null;
  const scale = (key: string) => { const number = Number(params.get(key) || 0.17); if (!Number.isFinite(number) || number < 0.001 || number > 10) throw new Error("Invalid ring scale."); return number; };
  const metal = (key: string) => { const value = params.get(key) || "#C2C2C3"; if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Invalid ring metal."); return value; };
  return { head: asset(params.get("head"), origin), band: asset(params.get("band"), origin), headScale: scale("headScale"), bandScale: scale("bandScale"), headMetal: metal("headMetal"), bandMetal: metal("bandMetal"), label: (params.get("label") || "Your custom ring").slice(0,160) };
}

// Match the builder: its mesh cache retains each mesh's local CAD transform,
// excluding the outer 3DM viewer centering and automatic scaling nodes.
function part(scene: THREE.Group, scale: number, color: string, name: string) {
  const group = new THREE.Group(); group.name = name; group.scale.setScalar(scale);
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const mesh = object.clone(false); mesh.geometry = object.geometry.clone();
    mesh.material = Array.isArray(object.material) ? object.material.map(m => m.clone()) : object.material.clone();
    mesh.userData = { ...object.userData, arMetalHex: color, arPart: name };
    group.add(mesh);
  });
  return group;
}

export function bandDimensions(band: THREE.Object3D) {
  band.updateWorldMatrix(true, true);
  const points: THREE.Vector3[] = []; const bounds = new THREE.Box3();
  band.traverse(object => {
    if (!(object instanceof THREE.Mesh) || isDiamondMesh(object)) return;
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
      points.push(point); bounds.expandByPoint(point);
    }
  });
  if (bounds.isEmpty()) throw new Error("The band has no usable metal geometry.");
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const outerRadius = Math.max(size.x,size.z) * 0.5;
  const radii = points.map(p => Math.hypot(p.x-center.x,p.z-center.z)).filter(r => r > outerRadius * 0.45).sort((a,b)=>a-b);
  const innerDiameter = (radii[Math.floor(radii.length * 0.06)] || outerRadius * 0.8) * 2;
  return { center, size, innerDiameter };
}

export function assembleSelectedRing(headScene: THREE.Group, bandScene: THREE.Group, selection: SelectedRing) {
  const head = part(headScene,selection.headScale,selection.headMetal,"head");
  const band = part(bandScene,selection.bandScale,selection.bandMetal,"band");
  const assembly = new THREE.Group(); assembly.name = "builder-ring-assembly"; assembly.add(head,band);
  assembly.updateMatrixWorld(true);
  const seat = alignRingHeadToShank(head,band);
  const dimensions = bandDimensions(band);
  // AR tracking expects the band axis along Y and the head along native -Z.
  // Rotate the assembly once; frame-to-frame motion remains on the pose group.
  const pivot = new THREE.Group(); pivot.name = "band-center"; pivot.add(assembly);
  assembly.position.copy(dimensions.center).multiplyScalar(-1);
  pivot.rotation.x = Math.PI;
  const scene = new THREE.Group(); scene.name = "selected-ring"; scene.add(pivot);
  scene.userData = { innerDiameter: dimensions.innerDiameter, assembled: true, label: selection.label, seat, parts: {head:selection.head,band:selection.band} };
  scene.updateMatrixWorld(true);
  return scene;
}

export async function loadSelectedRing(loader: GLTFLoader, selection: SelectedRing | null) {
  if (!selection) throw new Error("Choose a ring before opening try-on.");
  const [head,band] = await Promise.all([loader.loadAsync(selection.head),loader.loadAsync(selection.band)]);
  const scene = assembleSelectedRing(head.scene,band.scene,selection);
  // Cloned geometry/materials are owned by the assembled model from here on.
  for (const source of [head.scene,band.scene]) source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
  return { scene };
}
