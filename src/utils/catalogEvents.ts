export const CATALOG_CHANNEL = "ring-builder-catalog";
export const CATALOG_STORAGE_KEY = "ring-builder-catalog-update";
export type CatalogChange = "draft-saved" | "published";
export const announceCatalogChange = (type: CatalogChange) => {
  const event = { type, time:Date.now() };
  try { const channel = new BroadcastChannel(CATALOG_CHANNEL); channel.postMessage(event); channel.close(); } catch { /* Storage event supports older browsers. */ }
  try { localStorage.setItem(CATALOG_STORAGE_KEY,JSON.stringify(event)); } catch { /* Private browsing can disable storage. */ }
};
