import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Explicit local command: updates only pricing on the latest admin draft.
// No publishing, asset upload, Git push or deployment is performed.
const server = await createServer({ server: { middlewareMode:true }, appType:"custom" });
let mongo;
try {
  const store = await server.ssrLoadModule("/server/adminStore.ts");
  const demo = await server.ssrLoadModule("/server/pricingDemo.ts");
  const { quoteRing } = await server.ssrLoadModule("/src/utils/ringPricing.ts");
  const { mongoClient } = await server.ssrLoadModule("/server/db.ts");
  mongo = await mongoClient();
  const before = await store.adminState();
  await mkdir("artifacts",{recursive:true});
  const backup = `artifacts/admin-before-sample-pricing-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
  await writeFile(backup,JSON.stringify({revision:before.revision,baseReleaseId:before.baseReleaseId,catalog:before.draft},null,2),{mode:0o600});
  const pricing = demo.pricingDemoCatalog(before.draft).pricing;
  if (Object.keys(pricing.centerRates).length || Object.keys(pricing.heads).some(key=>key.split("|").length!==2) || [...Object.values(pricing.heads),...Object.values(pricing.bands)].some(entry=>entry.mode!=="weights" || Object.keys(entry.metalPrices || {}).length)) throw new Error("Sample pricing must not contain overrides.");
  const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const saved = await store.saveDraft({...before.draft,pricing},before.revision,process.env.ADMIN_USERNAME || "local-admin");
  if (fingerprint(before.active)!==fingerprint(saved.active)) throw new Error("The active catalog changed during this operation; inspect the saved draft before publishing.");
  const catalogWithoutPricing = catalog => { const {pricing,...rest}=catalog; return rest; };
  // Saving normalizes legacy metadata through the same path as the admin editor.
  const expected = store.checkedCatalog({...before.draft,pricing},before.active);
  if(fingerprint(catalogWithoutPricing(expected))!==fingerprint(catalogWithoutPricing(saved.draft))) throw new Error("Unexpected catalog changes.");
  const s = saved.draft.defaults;
  const quote=quoteRing(saved.draft,{shapeId:s.shapeId,carat:s.carat,headStyleId:s.headStyleId||"4-prong-talon",bandId:s.shankId,headMetalId:s.metalId,bandMetalId:s.metalId,size:pricing.defaultSize});
  console.log(JSON.stringify({savedDraftRevision:saved.revision,currency:pricing.currency,multiplier:pricing.multiplier,metalRates:Object.keys(pricing.metalRates).length,headWeightRows:Object.keys(pricing.heads).length,bandSizeRows:Object.keys(pricing.bands).length,overrides:0,defaultQuote:quote.total,activeCatalogUnchanged:true,backup},null,2));
} catch(error) { console.error(error instanceof Error ? error.message : "Could not fill sample pricing"); process.exitCode=1; }
finally { await server.close(); if(mongo)await mongo.close(); }
