export type PortraitEnvironment = { url: string; rotation: number; intensity: number; photoReflections: boolean };

const caches = new WeakMap<object, Map<string, any>>();
/** Import only the chosen local HDR/EXR. Keep at most two decoded maps. */
export async function loadPortraitEnvironment(viewer: any, importer: any, url: string) {
  let cache = caches.get(viewer);
  if (!cache) {
    cache = new Map(); caches.set(viewer, cache);
    const owned = cache;
    viewer.addEventListener?.("dispose", () => { for (const asset of owned.values()) asset.dispose?.(); owned.clear(); });
  }
  if (cache.has(url)) return cache.get(url);
  if (!importer?.importSinglePath) throw new Error("Environment importer is unavailable.");
  const asset = await importer.importSinglePath(url);
  cache.set(url, asset);
  while (cache.size > 2) { const first = cache.keys().next().value!; cache.get(first)?.dispose?.(); cache.delete(first); }
  return asset;
}
