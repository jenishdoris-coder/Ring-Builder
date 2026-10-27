import type { RingCatalog, CaratOption } from "../types/catalog";
import type { ComponentPrice, PriceQuote, PriceSelection, PricingConfig } from "../types/pricing";
export const LEGACY_HEAD_STYLE = "4-prong-talon";
export const headStyleId = (head: CaratOption) => head.styleId || LEGACY_HEAD_STYLE;
export const getHeadStyles = (catalog: RingCatalog) => catalog.headStyles?.length ? catalog.headStyles : [{ id: LEGACY_HEAD_STYLE, name: "4-Prong Talon", enabled: true }];
export const emptyPricing = (): PricingConfig => ({ enabled: false, currency: "USD", multiplier: 1, metalRates: {}, centerRates: {}, heads: {}, bands: {}, sizeSystem: "US", sizes: ["5", "6", "7", "8", "9"], defaultSize: "7" });
export const headPriceKey = (styleId: string, carat: number, shapeId?: string) => `${styleId}|${carat}${shapeId ? `|${shapeId}` : ""}`;
export const bandPriceKey = (bandId: string, size: string) => `${bandId}|${size}`;
export const componentPricingOnly = (pricing: PricingConfig): PricingConfig => {
  const { mode, fixedPrice, fixedVariants, ...rest } = pricing as PricingConfig & { mode?: unknown; fixedPrice?: unknown; fixedVariants?: unknown };
  return rest;
};
export const money = (value: number, currency: string) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } };
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12;
export const quoteRing = (catalog: RingCatalog, selection: PriceSelection, config = catalog.pricing): PriceQuote => {
  const p = config || emptyPricing();
  const quote: PriceQuote = { total: null, subtotal: 0, multiplier: p.multiplier, currency: p.currency, issues: [], lines: [], goldGrams: 0, diamondCarats: 0 };
  const shape = catalog.shapes.find(item => item.id === selection.shapeId && item.enabled !== false);
  const head = shape?.carats.find(item => item.carat === selection.carat && headStyleId(item) === selection.headStyleId && item.enabled !== false);
  if (!head || !getHeadStyles(catalog).some(item => item.id === selection.headStyleId && item.enabled !== false)) quote.issues.push("This head model is unavailable.");
  if (!catalog.shanks.some(item => item.id === selection.bandId && item.enabled !== false)) quote.issues.push("This band is unavailable.");
  for (const metalId of [selection.headMetalId, selection.bandMetalId]) if (!catalog.metals.some(item => item.id === metalId && item.enabled !== false)) quote.issues.push("The selected metal is unavailable.");
  if (!p.sizes.includes(selection.size)) quote.issues.push("Choose an available ring size.");
  if (!numeric(p.multiplier) || p.multiplier <= 0) quote.issues.push("Set a valid master multiplier.");
  const line = (label: string, amount: number, detail?: string) => { quote.lines.push({ label, amount, detail }); quote.subtotal += amount; };
    const centerRate = p.centerRates[`${selection.shapeId}|${selection.carat}`] ?? p.diamondPerCarat;
    if (!numeric(centerRate)) quote.issues.push("Set the center diamond price per carat.");
    else line("Center diamond", selection.carat * centerRate, `${selection.carat} ct × ${money(centerRate, p.currency)}/ct`);
    quote.diamondCarats = selection.carat;
    const component = (entry: ComponentPrice | undefined, label: string, metalId: string) => {
      if (!entry) { quote.issues.push(`Enter ${label.toLowerCase()} pricing for this ${label === "Head" ? "center carat" : "ring size"}.`); return; }
      if (entry.mode === "fixed") {
        const price = entry.metalPrices?.[metalId] ?? entry.fixedPrice;
        if (!numeric(price)) quote.issues.push(`Set the ${label.toLowerCase()} fixed price.`);
        else line(label, price, "Fixed component price");
        return;
      }
      if (!numeric(entry.goldGrams) || !numeric(entry.diamondCarats)) { quote.issues.push(`Enter both gold grams and accent diamond carats for ${label.toLowerCase()} (use 0 for no diamonds).`); return; }
      quote.goldGrams += entry.goldGrams; quote.diamondCarats += entry.diamondCarats;
      const rate = p.metalRates[metalId];
      if (entry.goldGrams > 0 && !numeric(rate?.perGram)) quote.issues.push(`Set the gold rate for ${catalog.metals.find(metal => metal.id === metalId)?.name || metalId}.`);
      else line(`${label} gold`, entry.goldGrams * (rate?.perGram || 0), `${entry.goldGrams} g`);
      const diamondRate = p.accentDiamondPerCarat ?? p.diamondPerCarat;
      if (entry.diamondCarats > 0 && !numeric(diamondRate)) quote.issues.push("Set the accent diamond price per carat.");
      else if (entry.diamondCarats > 0) line(`${label} diamonds`, entry.diamondCarats * (diamondRate || 0), `${entry.diamondCarats} ct`);
      if (rate?.finishCharge) line(`${label} finish`, rate.finishCharge);
    };
    component(p.heads[headPriceKey(selection.headStyleId, selection.carat, selection.shapeId)] ?? p.heads[headPriceKey(selection.headStyleId, selection.carat)], "Head", selection.headMetalId);
    component(p.bands[bandPriceKey(selection.bandId, selection.size)], "Band", selection.bandMetalId);
  quote.issues = [...new Set(quote.issues)];
  if (!Number.isFinite(quote.subtotal) || quote.subtotal * p.multiplier > Number.MAX_SAFE_INTEGER / 1000) quote.issues.push("The calculated price exceeds the supported amount.");
  if (!quote.issues.length) {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).resolvedOptions().maximumFractionDigits;
    const factor = 10 ** (digits ?? 2);
    quote.total = Math.round((quote.subtotal * p.multiplier + Number.EPSILON) * factor) / factor;
  }
  return quote;
};
/** Empty fields stay unconfigured; zero is an intentional value, not a fallback. */
export const validatePricing = (input: unknown): string[] => {
  if (input === undefined) return [];
  const p = input as PricingConfig;
  if (!p || typeof p !== "object") return ["Pricing settings are invalid."];
  const errors: string[] = [];
  try { if (!/^[A-Z]{3}$/.test(p.currency)) throw 0; new Intl.NumberFormat("en", { style: "currency", currency: p.currency }); } catch { errors.push("Choose a valid currency."); }
  if (typeof p.enabled !== "boolean" || !numeric(p.multiplier) || p.multiplier <= 0 || p.multiplier > 1000) errors.push("Check the master multiplier (greater than zero, up to 1000).");
  if (!["US", "India", "UK", "EU", "Custom"].includes(p.sizeSystem) || !Array.isArray(p.sizes) || !p.sizes.length || p.sizes.length > 100 || p.sizes.some(size => typeof size !== "string" || !/^[a-zA-Z0-9 .-]{1,16}$/.test(size)) || new Set(p.sizes).size !== p.sizes.length || !p.sizes.includes(p.defaultSize)) errors.push("Add unique ring sizes and select an available default size.");
  for (const value of [p.diamondPerCarat, p.accentDiamondPerCarat]) if (value !== undefined && !numeric(value)) errors.push("Prices must be nonnegative finite numbers.");
  for (const name of ["centerRates", "heads", "bands", "metalRates"] as const) {
    const entries = p[name];
    if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length > 10000) { errors.push("A pricing table is invalid or too large."); continue; }
    for (const [key, value] of Object.entries(entries)) {
      if (!/^[a-zA-Z0-9_| .-]{1,400}$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) { errors.push("A pricing record has an invalid identifier."); continue; }
      if (name === "centerRates") { if (!numeric(value)) errors.push("Prices must be nonnegative finite numbers."); }
      else if (name === "metalRates") {
        const rate = value as PricingConfig["metalRates"][string];
        if (!rate || typeof rate !== "object" || [rate.perGram, rate.finishCharge].some(number => number !== undefined && !numeric(number))) errors.push("Gold rates and finish charges must be nonnegative numbers.");
      } else {
        const part = value as ComponentPrice;
        if (!part || typeof part !== "object" || !["fixed", "weights"].includes(part.mode) || [part.goldGrams, part.diamondCarats, part.fixedPrice].some(number => number !== undefined && !numeric(number))) errors.push("Component prices and weights must be nonnegative numbers.");
        if (part?.metalPrices && (typeof part.metalPrices !== "object" || Array.isArray(part.metalPrices) || Object.values(part.metalPrices).some(number => !numeric(number)))) errors.push("Metal-specific component prices are invalid.");
      }
    }
  }
  return [...new Set(errors)];
};
