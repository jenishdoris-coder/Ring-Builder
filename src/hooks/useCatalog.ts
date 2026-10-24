import { useEffect, useState } from "react";
import { BOOTSTRAP_CATALOG } from "../config/staticModels";
import type { RingCatalog } from "../types/catalog";

export const isRingCatalog = (data: unknown): data is RingCatalog => {
  const catalog = data as RingCatalog | null;
  return Boolean(catalog?.schemaVersion === 1 && catalog.defaults && catalog.shapes?.length && catalog.shanks?.length && catalog.metals?.length &&
    catalog.shapes.every(shape => shape.id && shape.carats?.length && shape.carats.every(carat => carat.file && Number.isFinite(carat.carat))) &&
    catalog.shanks.every(shank => shank.id && shank.file) && catalog.metals.every(metal => metal.id && /^#[0-9a-f]{6}$/i.test(metal.hexCode)));
};

export const useCatalog = () => {
  const [catalog, setCatalog] = useState<RingCatalog>(BOOTSTRAP_CATALOG);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    fetch("/api/catalog", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async response => {
        if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!isRingCatalog(data)) throw new Error("Invalid catalog response");
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch(error => { if (!controller.signal.aborted) console.warn("Using the packaged catalog snapshot", error.message); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);
  return catalog;
};
