import { useEffect, useState } from "react";
import { BOOTSTRAP_CATALOG } from "../config/staticModels";
import type { RingCatalog } from "../types/catalog";
import { CATALOG_CHANNEL, CATALOG_STORAGE_KEY } from "../utils/catalogEvents";

export const isRingCatalog = (data: unknown): data is RingCatalog => {
  const catalog = data as RingCatalog | null;
  return Boolean(catalog?.schemaVersion === 1 && catalog.defaults && catalog.shapes?.length && catalog.shanks?.length && catalog.metals?.length &&
    catalog.shapes.every(shape => shape.id && shape.carats?.length && shape.carats.every(carat => carat.file && Number.isFinite(carat.carat))) &&
    catalog.shanks.every(shank => shank.id && shank.file) && catalog.metals.every(metal => metal.id && /^#[0-9a-f]{6}$/i.test(metal.hexCode)));
};

export const useCatalog = (onError?: (message: string) => void) => {
  const [catalog, setCatalog] = useState<RingCatalog>(BOOTSTRAP_CATALOG);
  useEffect(() => {
    const draft = new URLSearchParams(location.search).get("preview") === "draft";
    const demo = import.meta.env.DEV && new URLSearchParams(location.search).get("demo") === "pricing";
    let controller: AbortController | undefined;
    let timeout: number | undefined;
    let lastRequest = 0;
    let stopped = false;
    const refresh = (force = false) => {
      if (stopped || !force && Date.now() - lastRequest < 1000) return;
      lastRequest = Date.now();
      controller?.abort(); window.clearTimeout(timeout);
      const request = new AbortController(); controller = request;
      timeout = window.setTimeout(() => request.abort(),12000);
      const path = demo ? "/api/pricing-demo" : draft ? "/api/admin?action=preview" : "/api/catalog";
      const url = force ? `${path}${path.includes("?") ? "&" : "?"}refresh=${Date.now()}` : path;
      fetch(url, { signal: request.signal, cache:"no-store", headers: { Accept: "application/json" } })
      .then(async response => {
        let fromDraft = draft && !demo;
        if (fromDraft && (response.status === 401 || response.status === 403)) {
          response = await fetch(`/api/catalog?refresh=${Date.now()}`,{signal:request.signal,cache:"no-store",headers:{Accept:"application/json"}});
          fromDraft = false;
        }
        if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!isRingCatalog(data)) throw new Error("Invalid catalog response");
        const next: RingCatalog = {...data,...(draft && !demo ? {previewSource:fromDraft ? "draft" : "published"} : {})};
        if (!request.signal.aborted && !stopped) { setCatalog(current => JSON.stringify(current) === JSON.stringify(next) ? current : next); onError?.(draft && !demo && !fromDraft ? "Sign in to preview the draft. Showing the published configuration and prices." : ""); }
      })
      .catch(error => { if (!request.signal.aborted && !stopped) { console.warn("Keeping the last available catalog", error.message); if (draft) onError?.("Sign into the admin to load this saved draft. The regular builder uses published pricing."); } })
      .finally(() => { if (controller === request) window.clearTimeout(timeout); });
    };
    const focus = () => refresh();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    let lastSignal: unknown;
    const message = (data: {type?: string;time?:number}) => { if (!data || data.time === lastSignal) return; if (data.type === "published" || draft && data.type === "draft-saved") { lastSignal = data.time; refresh(true); } };
    const storage = (event: StorageEvent) => { if (event.key !== CATALOG_STORAGE_KEY || !event.newValue) return; try { message(JSON.parse(event.newValue)); } catch { /* Ignore unrelated malformed values. */ } };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(CATALOG_CHANNEL); channel.onmessage = event => message(event.data); } catch { /* Storage and focus events remain available. */ }
    window.addEventListener("focus",focus);
    window.addEventListener("pageshow",focus);
    document.addEventListener("visibilitychange",visible);
    window.addEventListener("storage",storage);
    refresh(true);
    return () => { stopped = true; window.clearTimeout(timeout); controller?.abort(); channel?.close(); window.removeEventListener("focus",focus); window.removeEventListener("pageshow",focus); document.removeEventListener("visibilitychange",visible); window.removeEventListener("storage",storage); };
  }, [onError]);
  return catalog;
};
