import type { MutableRefObject } from "react";
import { AssetManagerPlugin } from "webgi";
import type { PartLoadType, PartMeshCaches } from "../types/ring.types";
import type { RingRotation } from "../types/ring.types";
import { RING_SCALE_MULTIPLIER } from "../config/ringConfig";
import {
  extractMeshesFromImportResult,
  detachImportedFromScene,
  isCacheMeshPristine,
  cloneMeshForDisplay,
  ensureUniqueDiamondMaterialForMesh,
} from "./meshUtils";
import { disableModelGltfAnimations, disableViewerGltfAnimations } from "./sceneUtils";

// ---------------------------------------------------------------------------
// GLB import options — avoids embedded WEBGI viewer config overriding scene
// ---------------------------------------------------------------------------

export const PART_LOAD_OPTIONS = {
  mergeMaterials: false,
  mergeMeshes: false,
  merge: false,
  autoScale: false,
  autoCenter: false,
  addToRoot: false,
  loadAnimations: false,
} as const;

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

export const getPartLoadKey = (loadType: PartLoadType, fileUrl: string) =>
  `${loadType}::${fileUrl}`;

export const getPartModelCache = (
  loadType: PartLoadType,
  caches: PartMeshCaches,
) => {
  if (loadType === "head") return caches.head;
  if (loadType === "band") return caches.band;
  return caches.shank;
};

/** Unique per GLB + geometry so 2ct bake does not overwrite 1ct offset cache. */
export const getDiamondBakeCacheKey = (
  child: any,
  fileUrl?: string,
  forceRefresh = false,
) => {
  const geoId = child.geometry?.uuid || child.uuid || "geo";
  const meshName = (child.name || "diamond").replace(/\s+/g, "_");
  const filePart = fileUrl
    ? encodeURIComponent(fileUrl).slice(0, 80)
    : "unknown";
  const meshId = child.uuid || geoId;
  const base = `${filePart}__${meshName}__${meshId}`;
  return forceRefresh ? `${base}__r_${Date.now()}` : base;
};

// ---------------------------------------------------------------------------
// Cache validation
// ---------------------------------------------------------------------------

export const getValidCachedMeshes = (
  cache: Map<string, any[]>,
  fileUrl: string,
): any[] | undefined => {
  const cachedMeshes = cache.get(fileUrl);
  if (!cachedMeshes?.length) return undefined;
  if (!cachedMeshes.every(isCacheMeshPristine)) {
    console.warn(
      `[loadPart] Discarding corrupted cache for ${fileUrl}, reloading`,
    );
    cache.delete(fileUrl);
    return undefined;
  }
  return cachedMeshes;
};

export const disposeImportedMeshes = (meshes: any[]) => {
  meshes.forEach((mesh) => {
    mesh.parent?.remove?.(mesh);
  });
};

// ---------------------------------------------------------------------------
// Container builder
// ---------------------------------------------------------------------------

export const buildPartContainer = (
  Object3DCtor: any,
  variant: any,
  displayMeshes: any[],
  loadType: PartLoadType,
  fileUrl: string,
  ringRotation: RingRotation,
  ringPosition?: { x: number; y: number; z: number },
  scaleMultiplier = RING_SCALE_MULTIPLIER,
) => {
  const container = new Object3DCtor();
  container.name = variant?.name || loadType;
  const baseScale = typeof variant?.scale === "number" ? variant.scale : 0.17;
  const finalScale = baseScale * scaleMultiplier;
  container.scale.set(finalScale, finalScale, finalScale);
  const px = ringPosition?.x ?? 0;
  const py = ringPosition?.y ?? 0;
  const pz = (ringPosition?.z ?? 0) + (typeof variant?.posZ === "number" ? variant.posZ : 0);
  container.position.set(px, py, pz);
  const rx = (ringRotation.x * Math.PI) / 180;
  const ry = (ringRotation.y * Math.PI) / 180;
  const rz = (ringRotation.z * Math.PI) / 180;
  container.rotation.set(rx, ry, rz, "XYZ");
  displayMeshes.forEach((mesh) => {
    ensureUniqueDiamondMaterialForMesh(mesh);
    container.add(mesh);
  });
  container.visible = false;
  (container as any).__sourceFileUrl = fileUrl;
  (container as any).__partLoadType = loadType;
  return container;
};

// ---------------------------------------------------------------------------
// Asset manager resolver
// ---------------------------------------------------------------------------

export const resolveAssetManager = (viewer: any) => {
  if (!viewer) return null;
  return (
    viewer.getManager?.() ?? viewer.getPlugin?.(AssetManagerPlugin) ?? null
  );
};

// ---------------------------------------------------------------------------
// Network loader with in-flight deduplication
// ---------------------------------------------------------------------------

/**
 * Network-import head/shank/band meshes into the URL cache (no scene commit).
 * Dedupes concurrent loads via partLoadInFlightRef.
 */
export const ensurePartMeshesCached = async (
  viewer: any,
  loadType: PartLoadType,
  fileUrl: string,
  caches: PartMeshCaches,
  partLoadInFlightRef: MutableRefObject<Map<string, Promise<boolean>>>,
  options?: { loadId?: number; loadIdRef?: MutableRefObject<number> },
): Promise<boolean> => {
  const targetCache = getPartModelCache(loadType, caches);
  if (getValidCachedMeshes(targetCache, fileUrl)) return true;

  const loadKey = getPartLoadKey(loadType, fileUrl);
  const inFlight = partLoadInFlightRef.current.get(loadKey);
  if (inFlight) return inFlight;

  const networkLoad = (async (): Promise<boolean> => {
    const loadId = options?.loadId;
    const loadIdRef = options?.loadIdRef;
    if (loadIdRef && loadId !== undefined && loadId !== loadIdRef.current) {
      return false;
    }

    const activeViewer = viewer;
    if (!activeViewer || activeViewer !== viewer) return false;

    const activeManager = resolveAssetManager(activeViewer);
    if (!activeManager?.importer?.importPath) return false;

    const cleanupSceneImport = (
      imported: any[] = [],
      meshesToDispose: any[] = [],
    ) => {
      detachImportedFromScene(imported);
      disposeImportedMeshes(meshesToDispose);
    };

    // Import into the cache without adding the source scene to the viewer.
    // addFromPath applies the GLB's embedded WEBGI_viewer configuration, which
    // replaces the current camera pose and controls on every uncached model.
    const imported = await activeManager.importer.importPath(fileUrl, {
      ...PART_LOAD_OPTIONS,
    });
    disableViewerGltfAnimations(activeViewer);

    const added = extractMeshesFromImportResult(imported);

    const staleLoad =
      loadIdRef && loadId !== undefined && loadId !== loadIdRef.current;

    if (added.length > 0 && !targetCache.has(fileUrl)) {
      added.forEach((mesh) => disableModelGltfAnimations(mesh));
      targetCache.set(fileUrl, added.map(cloneMeshForDisplay));
    }

    if (staleLoad) {
      cleanupSceneImport(imported, added);
      return false;
    }

    if (added.length === 0) {
      cleanupSceneImport(imported, added);
      return false;
    }

    cleanupSceneImport(imported, added);
    return !!getValidCachedMeshes(targetCache, fileUrl);
  })();

  partLoadInFlightRef.current.set(loadKey, networkLoad);
  try {
    return await networkLoad;
  } finally {
    partLoadInFlightRef.current.delete(loadKey);
  }
};

export const prefetchHeadShankMeshes = (
  viewer: any,
  caches: PartMeshCaches,
  partLoadInFlightRef: MutableRefObject<Map<string, Promise<boolean>>>,
  headFile: string | null,
  shankFile: string | null,
) => {
  const tasks: Promise<boolean>[] = [];
  if (headFile) {
    tasks.push(
      ensurePartMeshesCached(viewer, "head", headFile, caches, partLoadInFlightRef),
    );
  }
  if (shankFile) {
    tasks.push(
      ensurePartMeshesCached(viewer, "shank", shankFile, caches, partLoadInFlightRef),
    );
  }
  return tasks.length > 0 ? Promise.all(tasks) : Promise.resolve([]);
};
