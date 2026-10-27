import type { RingCatalog } from "../types/catalog";
import { getHeadStyles, headStyleId, validatePricing, LEGACY_HEAD_STYLE } from "../utils/ringPricing";

export const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
export const catalogCounts = (catalog: RingCatalog) => ({ bands: catalog.shanks.length, heads: catalog.shapes.reduce((sum, shape) => sum + shape.carats.length, 0), shapes: catalog.shapes.length, metals: catalog.metals.length });
export const storefrontCatalog = (catalog: RingCatalog): RingCatalog => ({ ...catalog,
  headStyles: getHeadStyles(catalog).filter(style => style.enabled !== false),
  shapes: catalog.shapes.filter(shape => shape.enabled !== false).map(shape => ({ ...shape, carats: shape.carats.filter(head => head.enabled !== false && getHeadStyles(catalog).some(style => style.id === headStyleId(head) && style.enabled !== false)) })).filter(shape => shape.carats.length),
  shanks: catalog.shanks.filter(band => band.enabled !== false), metals: catalog.metals.filter(metal => metal.enabled !== false),
});

export const publicCatalog = (catalog: RingCatalog): RingCatalog => {
  const { pricing, ...rest } = catalog;
  return { ...rest, ...(pricing ? { pricingPublic: { enabled: pricing.enabled, currency: pricing.currency, sizeSystem: pricing.sizeSystem, sizes: pricing.sizes, defaultSize: pricing.defaultSize } } : {}) };
};
/** Server and editor use the same rules; the server also restricts asset hosts. */
export const validateCatalog = (input: unknown, allowedPrefixes?: string[]): string[] => {
  const errors: string[] = [];
  const catalog = input as RingCatalog;
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.shanks) || !Array.isArray(catalog.shapes) || !Array.isArray(catalog.metals) || !catalog.defaults) return ["The catalog structure is invalid."];
  const text = (value: unknown, max = 120) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const asset = (value: unknown, image = false) => {
    if (typeof value !== "string" || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
        (image ? /\.(webp|png|jpe?g)$/i : /\.glb$/i).test(url.pathname) && (!allowedPrefixes || allowedPrefixes.some(prefix => value.startsWith(prefix)));
    } catch { return false; }
  };
  const identifiers = (items: { id: string }[], label: string) => {
    if (items.length > 2000) errors.push(`Too many ${label}.`);
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(item.id) || seen.has(item.id)) errors.push(`Each ${label} needs a unique ID using letters, numbers, hyphens or underscores.`);
      seen.add(item?.id);
    }
  };
  identifiers(catalog.shanks, "band"); identifiers(catalog.shapes, "shape"); identifiers(catalog.metals, "metal");
  if (catalog.headStyles !== undefined && !Array.isArray(catalog.headStyles)) return ["Head settings are invalid."];
  const styles = getHeadStyles(catalog);
  identifiers(styles, "head setting");
  for (const style of styles) if (!text(style?.name) || style.enabled !== undefined && typeof style.enabled !== "boolean") errors.push("Each head setting needs a name and valid availability.");
  if (errors.length) return [...new Set(errors)];
  for (const band of catalog.shanks) {
    if (!band || !text(band.name) || !text(band.category) || !asset(band.file)) errors.push(`Band ${band?.name || "(unnamed)"} needs a name, collection and uploaded GLB.`);
    if (band?.thumbnail && !asset(band.thumbnail, true)) errors.push(`The thumbnail for ${band.name} is invalid.`);
    if (typeof band?.file === "string" && band.file.includes("/ring-builder/admin/") && !band.thumbnail) errors.push(`Add a selector thumbnail for ${band.name}.`);
    if (band?.enabled !== undefined && typeof band.enabled !== "boolean") errors.push("Band visibility is invalid.");
  }
  for (const shape of catalog.shapes) {
    if (!shape || !text(shape.name) || !Array.isArray(shape.carats) || shape.carats.length > 100) { errors.push("Every shape needs a name and a list of head models."); continue; }
    if (shape.image && !asset(shape.image, true)) errors.push(`The ${shape.name} shape image is invalid.`);
    if (shape.enabled !== undefined && typeof shape.enabled !== "boolean") errors.push("Shape visibility is invalid.");
    const carats = new Set<string>();
    for (const head of shape.carats) {
      if (!head || !Number.isFinite(head.carat) || head.carat <= 0 || head.carat > 25 || carats.has(`${headStyleId(head)}:${head.carat}`) || !styles.some(style => style.id === headStyleId(head)) || !asset(head.file) || !text(head.label) || !text(head.filename, 250)) errors.push(`${shape.name} needs unique setting/carat models, valid labels and uploaded GLBs.`);
      if (head?.thumbnail && !asset(head.thumbnail, true)) errors.push(`The ${shape.name} ${head.carat}ct thumbnail is invalid.`);
      if (typeof head?.file === "string" && head.file.includes("/ring-builder/admin/") && !head.thumbnail) errors.push(`Add a selector thumbnail for ${shape.name} ${head.carat}ct.`);
      if (head?.enabled !== undefined && typeof head.enabled !== "boolean") errors.push("Head visibility is invalid.");
      if (head) carats.add(`${headStyleId(head)}:${head.carat}`);
    }
  }
  for (const metal of catalog.metals) {
    if (!metal || !text(metal.name) || !/^#[0-9a-f]{6}$/i.test(metal.hexCode) || !/^#[0-9a-f]{6}$/i.test(metal.previewColor) || !text(metal.description, 500)) errors.push("Every metal needs a name, description and valid six-digit color.");
    if (metal?.enabled !== undefined && typeof metal.enabled !== "boolean") errors.push("Metal visibility is invalid.");
  }
  if (errors.length) return [...new Set(errors)].slice(0, 20);
  const visible = storefrontCatalog(catalog);
  const shape = visible.shapes.find(item => item.id === catalog.defaults.shapeId);
  if (!shape?.carats.some(item => item.carat === catalog.defaults.carat && headStyleId(item) === (catalog.defaults.headStyleId || LEGACY_HEAD_STYLE))) errors.push("Choose an available default head setting, shape and carat size.");
  if (!visible.shanks.some(item => item.id === catalog.defaults.shankId)) errors.push("Choose an available default band.");
  if (!visible.metals.some(item => item.id === catalog.defaults.metalId)) errors.push("Choose an available default metal.");
  for (const scale of [catalog.defaults.headScale, catalog.defaults.shankScale]) if (!Number.isFinite(scale) || scale <= 0 || scale > 100) errors.push("Model scales must be greater than zero and at most 100.");
  return [...new Set([...errors, ...validatePricing(catalog.pricing)])];
};
