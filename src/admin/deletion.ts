import type { RingCatalog } from "../types/catalog";
import { storefrontCatalog } from "./catalog";
import { getHeadStyles, headStyleId, LEGACY_HEAD_STYLE } from "../utils/ringPricing";

export type CatalogDeleteTarget = {kind:"band"|"metal"|"shape"|"style";id:string} | {kind:"head";shapeId:string;styleId:string;carat:number};
const headKey = (style:string,carat:number,shape?:string) => `${style}|${carat}${shape ? `|${shape}` : ""}`;

/** Remove catalog references only. Public files and prior live releases stay intact. */
export const deleteCatalogItem = (source: RingCatalog,target:CatalogDeleteTarget) => {
  const catalog = structuredClone(source);
  let label = "", removedModels = 0;
  if (target.kind === "band") {
    const item = catalog.shanks.find(item => item.id === target.id);
    if (!item) throw new Error("This band is no longer in the draft.");
    label = item.name; removedModels = 1;
    catalog.shanks = catalog.shanks.filter(item => item.id !== target.id);
    if (catalog.pricing) for (const key of Object.keys(catalog.pricing.bands)) if (key.split("|")[0] === target.id) delete catalog.pricing.bands[key];
  } else if (target.kind === "metal") {
    const item = catalog.metals.find(item => item.id === target.id);
    if (!item) throw new Error("This metal is no longer in the draft.");
    label = item.name; catalog.metals = catalog.metals.filter(item => item.id !== target.id);
    if (catalog.pricing) {
      delete catalog.pricing.metalRates[target.id];
      for (const part of [...Object.values(catalog.pricing.heads),...Object.values(catalog.pricing.bands)]) if (part.metalPrices) delete part.metalPrices[target.id];
    }
  } else if (target.kind === "shape") {
    const item = catalog.shapes.find(item => item.id === target.id);
    if (!item) throw new Error("This shape is no longer in the draft.");
    label = item.name; removedModels = item.carats.length;
    catalog.shapes = catalog.shapes.filter(item => item.id !== target.id);
  } else if (target.kind === "style") {
    const styles = getHeadStyles(catalog), style = styles.find(item => item.id === target.id);
    if (!style) throw new Error("This setting is no longer in the draft.");
    label = style.name; catalog.headStyles = styles.filter(item => item.id !== target.id);
    catalog.shapes.forEach(shape => { removedModels += shape.carats.filter(head => headStyleId(head) === target.id).length; shape.carats = shape.carats.filter(head => headStyleId(head) !== target.id); });
  } else if (target.kind === "head") {
    const shape = catalog.shapes.find(shape => shape.id === target.shapeId);
    const item = shape?.carats.find(head => head.carat === target.carat && headStyleId(head) === target.styleId);
    if (!shape || !item) throw new Error("This head is no longer in the draft.");
    label = `${shape.name} ${item.carat} ct · ${getHeadStyles(catalog).find(style => style.id === target.styleId)?.name || "head"}`;
    removedModels = 1; shape.carats = shape.carats.filter(head => !(head.carat === target.carat && headStyleId(head) === target.styleId));
  }
  // Prune prices only when their matching model/shape is actually gone.
  if (catalog.pricing) {
    const common = new Set<string>(), exact = new Set<string>(), centers = new Set<string>();
    catalog.shapes.forEach(shape => shape.carats.forEach(head => { common.add(headKey(headStyleId(head),head.carat)); exact.add(headKey(headStyleId(head),head.carat,shape.id)); centers.add(`${shape.id}|${head.carat}`); }));
    const priorCommon = new Set<string>(), priorExact = new Set<string>(), priorCenters = new Set<string>();
    source.shapes.forEach(shape => shape.carats.forEach(head => { priorCommon.add(headKey(headStyleId(head),head.carat)); priorExact.add(headKey(headStyleId(head),head.carat,shape.id)); priorCenters.add(`${shape.id}|${head.carat}`); }));
    for (const key of Object.keys(catalog.pricing.heads)) {
      const parts = key.split("|");
      const removed = parts.length === 2 ? priorCommon.has(key) && !common.has(key) : priorExact.has(key) && !exact.has(key);
      if (removed || target.kind === "style" && parts[0] === target.id || target.kind === "shape" && parts[2] === target.id) delete catalog.pricing.heads[key];
    }
    for (const key of Object.keys(catalog.pricing.centerRates)) if (priorCenters.has(key) && !centers.has(key) || target.kind === "shape" && key.split("|")[0] === target.id) delete catalog.pricing.centerRates[key];
  }
  const visible = storefrontCatalog(catalog);
  if (!visible.shanks.length) throw new Error("Keep at least one available band. Add another band before deleting this one.");
  if (!visible.metals.length) throw new Error("Keep at least one available metal. Add another metal before deleting this one.");
  if (!visible.shapes.length) throw new Error("Keep at least one available head model. Add another head before deleting this item.");
  const changes: string[] = [];
  if (!visible.shanks.some(item => item.id === catalog.defaults.shankId)) { catalog.defaults.shankId = visible.shanks[0].id; changes.push(`Default band changes to ${visible.shanks[0].name}.`); }
  if (!visible.metals.some(item => item.id === catalog.defaults.metalId)) { catalog.defaults.metalId = visible.metals[0].id; changes.push(`Default metal changes to ${visible.metals[0].name}.`); }
  const defaultStyle = catalog.defaults.headStyleId || LEGACY_HEAD_STYLE;
  let shape = visible.shapes.find(item => item.id === catalog.defaults.shapeId);
  if (!shape?.carats.some(head => headStyleId(head) === defaultStyle && head.carat === catalog.defaults.carat)) {
    shape ||= visible.shapes[0];
    const sameStyle = shape.carats.filter(head => headStyleId(head) === defaultStyle);
    const candidates = sameStyle.length ? sameStyle : shape.carats;
    const head = [...candidates].sort((a,b) => Math.abs(a.carat-catalog.defaults.carat)-Math.abs(b.carat-catalog.defaults.carat) || a.carat-b.carat)[0];
    catalog.defaults.shapeId = shape.id; catalog.defaults.carat = head.carat; catalog.defaults.headStyleId = headStyleId(head);
    changes.push(`Default head changes to ${shape.name} ${head.carat} ct.`);
  }
  return { catalog,label,removedModels,changes };
};
