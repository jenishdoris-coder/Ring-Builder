import { randomUUID } from "node:crypto";
import type { RingCatalog } from "../src/types/catalog.js";
import { catalogCounts, storefrontCatalog, validateCatalog } from "../src/admin/catalog.js";
import { database, mongoClient } from "./db.js";
import { componentPricingOnly, getHeadStyles, headStyleId } from "../src/utils/ringPricing.js";
import {catalogAssetUrls,catalogModels,pruneCatalogThumbnails} from '../src/utils/catalogAssets.js';
import {deletionId,pendingAssetCleanup,processAssetCleanup,removedCatalogAssets} from './adminAssets.js';

export class AdminError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (message: string, status = 400): never => { throw new AdminError(status, message); };
export const activeCatalog = async () => {
  const catalog = await (await database()).collection<any>("ring_builder_catalogs").findOne({ _id: "active" });
  if (!catalog) return fail("The live catalog is not available.", 503);
  const { _id, stats, createdAt, updatedAt, ...data } = catalog;
  return { catalog: data as RingCatalog, updatedAt: updatedAt || createdAt || null, stats };
};
const cleanCatalog = (catalog: RingCatalog, active: RingCatalog): RingCatalog => pruneCatalogThumbnails({
  schemaVersion: 1, releaseId: active.releaseId, assetBaseUrl: active.assetBaseUrl,
  headStyles: getHeadStyles(catalog).map(style => ({ id: style.id, name: style.name.trim(), enabled: style.enabled !== false })),
  ...(catalog.pricing ? { pricing: structuredClone(componentPricingOnly(catalog.pricing)) } : {}),
  ...(catalog.appearance ? { appearance: structuredClone(catalog.appearance) } : {}),
  shanks: catalog.shanks.map(item => ({ id: item.id, name: item.name.trim(), rawName: item.name.trim(), category: item.category.trim(), file: item.file, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), enabled: item.enabled !== false })),
  shapes: catalog.shapes.map(item => ({ id: item.id, name: item.name.trim(), folder: typeof item.folder === "string" ? item.folder.slice(0, 120) : item.name, ...(item.image ? { image: item.image } : {}), enabled: item.enabled !== false,
    carats: item.carats.map(head => ({ carat: head.carat, styleId: headStyleId(head), label: head.label.trim(), file: head.file, filename: head.filename, ...(head.thumbnail ? { thumbnail: head.thumbnail } : {}), enabled: head.enabled !== false })).sort((a, b) => a.carat - b.carat) })),
  metals: catalog.metals.map(item => ({ id: item.id, name: item.name.trim(), hexCode: item.hexCode.toUpperCase(), previewColor: item.previewColor.toUpperCase(), gradient: `linear-gradient(135deg, ${item.hexCode}, #ffffff, ${item.hexCode})`, description: item.description.trim(), enabled: item.enabled !== false })),
  defaults: { shapeId: catalog.defaults.shapeId, carat: catalog.defaults.carat, shankId: catalog.defaults.shankId, metalId: catalog.defaults.metalId, headScale: catalog.defaults.headScale, shankScale: catalog.defaults.shankScale, ...(catalog.defaults.headStyleId ? { headStyleId: catalog.defaults.headStyleId } : {}) },
});
export const checkedCatalog = (input: unknown, active: RingCatalog) => {
  const prefixes = [`${active.assetBaseUrl.replace(/\/+$/, "")}/`];
  const bucket = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (bucket) prefixes.push(`${bucket}/ring-builder/`);
  const errors = validateCatalog(input, prefixes);
  if (errors.length) return fail(errors.join(" "));
  return cleanCatalog(input as RingCatalog, active);
};
export const event = async (type: string, message: string, username: string) => {
  await (await database()).collection<any>("ring_builder_admin_events").insertOne({ _id: randomUUID(), type, message, username, createdAt: new Date() });
};
export const adminState = async () => {
  const db = await database();
  const [active, saved, legacy, activity, storage, pendingCleanup] = await Promise.all([
    activeCatalog(), db.collection<any>("ring_builder_admin_catalogs").findOne({ _id: "store" }),
    // Retain existing admin edits and hidden models when upgrading from the old workflow.
    db.collection<any>("ring_builder_admin_drafts").findOne({ _id: "store" }),
    db.collection<any>("ring_builder_admin_events").find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
    db.collection("ring_builder_assets").aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$bytes" } } }]).toArray(),
    pendingAssetCleanup(),
  ]);
  const stored = saved ?? legacy;
  const current = stored?.baseReleaseId === active.catalog.releaseId ? stored : undefined;
  return { active: active.catalog, catalog: current?.catalog ?? active.catalog, publishedAt: active.updatedAt,
    revision: stored?.revision ?? 0, baseReleaseId: active.catalog.releaseId,
    hasUnpublishedChanges: !saved && Boolean(current?.dirty), activity, cleanup:{pending:pendingCleanup},
    storage: { count: storage[0]?.count ?? 0, bytes: storage[0]?.bytes ?? 0 },
    connections: { database: true, uploads: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCESS_KEY_ID && process.env.CLOUDFLARE_SECRET_ACCESS_KEY && process.env.CLOUDFLARE_BUCKET_NAME && process.env.CLOUDFLARE_R2_PUBLIC_URL) },
  };
};

/** One request validates and publishes the submitted edits atomically. */
export const publishCatalog = async (input: unknown, revision: number, baseReleaseId: string, username: string) => {
  if (!Number.isInteger(revision) || revision < 0 || typeof baseReleaseId !== "string" || !baseReleaseId || baseReleaseId.length > 200) return fail("Reload the admin before publishing.");
  const client = await mongoClient(), db = await database();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const settings = db.collection<any>("ring_builder_admin_catalogs"), catalogs = db.collection<any>("ring_builder_catalogs");
      const saved = await settings.findOne({ _id: "store" }, { session });
      const legacy = saved ? undefined : await db.collection<any>("ring_builder_admin_drafts").findOne({ _id: "store" }, { session });
      const active = await catalogs.findOne({ _id: "active" }, { session });
      if (!active || active.releaseId !== baseReleaseId || (saved?.revision ?? legacy?.revision ?? 0) !== revision) return fail("The catalog changed in another window. Reload before publishing.", 409);
      const catalog = checkedCatalog(input, active);
      const previous=saved??legacy,oldCatalog=previous?.baseReleaseId===active.releaseId?previous.catalog:active;
      const modelFiles=new Set(catalogModels(catalog).map(model=>model.file));
      const removedFiles=[...new Set(catalogModels(oldCatalog).map(model=>model.file))].filter(file=>!modelFiles.has(file));
      const associated=removedFiles.length?await db.collection<any>('ring_builder_assets').find({modelFile:{$in:removedFiles}},{session,projection:{url:1}}).toArray():[];
      const deletions=db.collection<any>('ring_builder_asset_deletions');
      if(await deletions.findOne({_id:{$in:[...catalogAssetUrls(catalog)].map(deletionId)},status:{$in:['pending','deleting','deleted']}},{session}))return fail('This catalog contains a deleted file. Upload that model or image again before publishing.',409);
      const releaseId = `admin-${randomUUID()}`, now = new Date();
      const removed=removedCatalogAssets(oldCatalog,catalog,associated);
      if(removed.length)await deletions.bulkWrite(removed.map(asset=>({updateOne:{filter:{_id:deletionId(asset.url)},update:{$setOnInsert:{...asset,status:'pending',releaseId,createdAt:now,updatedAt:now}},upsert:true}})),{session});
      const visible = { ...storefrontCatalog(catalog), releaseId };
      await catalogs.insertOne({ _id: `release:${releaseId}`, ...visible, stats: catalogCounts(visible), createdAt: now, publishedBy: username }, { session });
      await catalogs.replaceOne({ _id: "active" }, { ...visible, stats: catalogCounts(visible), updatedAt: now, publishedBy: username }, { session });
      // Keep hidden catalog entries for the admin, while the storefront receives only available entries.
      await settings.replaceOne({ _id: "store" }, { catalog: { ...catalog, releaseId }, revision: revision + 1, baseReleaseId: releaseId, updatedAt: now, updatedBy: username }, { upsert: true, session });
      await db.collection<any>("ring_builder_admin_events").insertOne({ _id: randomUUID(), type: "published", message: "Catalog published to the ring builder", username, createdAt: now }, { session });
    });
  } finally { await session.endSession(); }
  const cleanup=await processAssetCleanup();
  return {...await adminState(),removedAssets:cleanup.deleted};
};
