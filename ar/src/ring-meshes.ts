import type { Mesh, Material } from "three";
export function isDiamondMesh(mesh: Mesh) {
  const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const names = [mesh.name, ...materials.map(material => material.name)];
  for (let node = mesh.parent; node; node = node.parent) names.push(node.name);
  return names.some(name => /gem|diamond|stone|shank_round/i.test(name || ""));
}
