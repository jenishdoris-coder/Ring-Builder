import { DIAMOND_COLOR_HEX, DIAMOND_COLOR_SRGB } from "../config/viewerConfig";

// ---------------------------------------------------------------------------
// Diamond mesh / material identification
// ---------------------------------------------------------------------------

export const isDiamondMeshOrMaterial = (name: string) => {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  
  if (n.includes("ring") || n === "head" || n === "shank" || n === "band") return false;
  
  if (/^gem\s*\d+/.test(n)) return true;
  if (/^diamond[_\s]/.test(n) || n.includes("diamond_round")) return true;
  if (n === "shank_round") return true;
  
  if (n === "diamond" || n.includes("diamondshape")) return true;
  if (n.includes("stone")) return true;
  
  return false;
};

export const isDiamondMaterialType = (mat: any) =>
  !!mat?.isDiamondMaterial ||
  mat?.typeSlug === "dmat" ||
  mat?.constructor?.TYPE === "DiamondMaterial";

export const meshBelongsToGemGroup = (mesh: any) => {
  let node: any = mesh;
  while (node) {
    if (isDiamondMeshOrMaterial(node.name || "")) return true;
    node = node.parent;
  }
  return false;
};

export const isDiamondMesh = (mesh: any) => {
  if (!mesh?.isMesh) return false;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const matName = mat?.name || "";
  return (
    meshBelongsToGemGroup(mesh) ||
    isDiamondMeshOrMaterial(mesh.name || "") ||
    isDiamondMeshOrMaterial(matName) ||
    isDiamondMaterialType(mat)
  );
};

export const getMeshPrimaryMaterial = (mesh: any) =>
  Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

// ---------------------------------------------------------------------------
// Diamond white albedo
// ---------------------------------------------------------------------------

export const applyDiamondWhiteColor = (mat: any) => {
  if (!mat?.color) return;
  if (typeof mat.color.setStyle === "function") {
    mat.color.setStyle(DIAMOND_COLOR_HEX);
  } else if (typeof mat.color.setHex === "function") {
    mat.color.setHex(DIAMOND_COLOR_SRGB);
  } else if (typeof mat.color.set === "function") {
    mat.color.set(1, 1, 1);
  }
  if (mat.emissive?.setHex) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0;
  mat.setDirty?.();
  mat.needsUpdate = true;
};

// ---------------------------------------------------------------------------
// Material cloning / cache helpers
// ---------------------------------------------------------------------------

/** Strip plugin renames/state so cache clones stay pristine GLB materials. */
export const stripDiamondPluginState = (mat: any) => {
  if (!mat?.clone) return mat;
  const next = mat.clone();
  const baseName = (next.name || "").split("_0_1_")[0] || next.name || "Diamond";
  next.name = baseName;
  if (next.userData) {
    delete next.userData.diamondPluginApplied;
    delete next.userData.__processed;
    delete next.userData.__properlyLoaded;
  }
  return next;
};

/** GLBs often share one material across Diamond_Round_* meshes — clone per mesh before bake. */
export const ensureUniqueDiamondMaterialForMesh = (mesh: any) => {
  if (!mesh?.isMesh) return;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((m: any) =>
      m ? stripDiamondPluginState(m) : m,
    );
  } else if (mesh.material) {
    mesh.material = stripDiamondPluginState(mesh.material);
  }
};

export const cloneMeshForDisplay = (mesh: any) => {
  const cloned = mesh.clone();
  if (!cloned.material) return cloned;
  if (Array.isArray(cloned.material)) {
    cloned.material = cloned.material.map(stripDiamondPluginState);
  } else {
    cloned.material = stripDiamondPluginState(cloned.material);
  }
  return cloned;
};

export const isCacheMeshPristine = (mesh: any) => {
  const materials = Array.isArray(mesh?.material)
    ? mesh.material
    : [mesh?.material];
  return materials.every(
    (mat: any) =>
      mat &&
      !isDiamondMaterialType(mat) &&
      !(mat.name || "").includes("_0_1_"),
  );
};

// ---------------------------------------------------------------------------
// Mesh collection helpers
// ---------------------------------------------------------------------------

export const isRenderableMesh = (obj: any) =>
  !!obj &&
  (obj.isMesh === true ||
    obj.isSkinnedMesh === true ||
    obj.type === "Mesh" ||
    obj.type === "SkinnedMesh");

export const collectMeshesFromRoot = (
  root: any,
  out: any[],
  seen = new Set<any>(),
) => {
  root?.traverse?.((child: any) => {
    if (!isRenderableMesh(child) || seen.has(child)) return;
    seen.add(child);
    out.push(child);
  });
};

/** WebGI addFromPath returns ISceneObject[] — meshes live under modelObject, not always in scene diff. */
export const extractMeshesFromImportResult = (imported: any) => {
  const meshes: any[] = [];
  const seen = new Set<any>();
  const items = Array.isArray(imported) ? imported : [imported];
  for (const entry of items) {
    if (!entry) continue;
    if (entry.modelObject) {
      collectMeshesFromRoot(entry.modelObject, meshes, seen);
      continue;
    }
    if (entry.scene) {
      collectMeshesFromRoot(entry.scene, meshes, seen);
      continue;
    }
    if (entry.isObject3D) {
      collectMeshesFromRoot(entry, meshes, seen);
      continue;
    }
    if (isRenderableMesh(entry) && !seen.has(entry)) {
      seen.add(entry);
      meshes.push(entry);
    }
  }
  return meshes;
};

export const detachImportedFromScene = (imported: any[]) => {
  for (const entry of imported || []) {
    const root = entry?.modelObject ?? entry;
    root?.parent?.remove?.(root);
    entry?.dispose?.();
  }
};

export const findPartContainerForMesh = (mesh: any, roots: any[]) => {
  let node: any = mesh;
  while (node) {
    if (roots.includes(node)) return node;
    node = node.parent;
  }
  return null;
};
