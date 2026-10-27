import { randomUUID } from "node:crypto";
import type { RingCatalog } from "../src/types/catalog";
import { catalogCounts, storefrontCatalog, validateCatalog } from "../src/admin/catalog";
import { database, mongoClient } from "./db";
import { componentPricingOnly, getHeadStyles, headStyleId } from "../src/utils/ringPricing";

export class AdminError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (message: string, status = 400): never => { throw new AdminError(status, message); };
export const activeCatalog = async () => {
  const catalog = await (await database()).collection<any>("ring_builder_catalogs").findOne({ _id: "active" });
  if (!catalog) return fail("The live catalog is not available.", 503);
  const { _id, stats, createdAt, updatedAt, ...data } = catalog;
  return { catalog: data as RingCatalog, updatedAt: updatedAt || createdAt || null, stats };
};
const cleanCatalog = (catalog: RingCatalog, active: RingCatalog): RingCatalog => ({
  schemaVersion: 1, releaseId: active.releaseId, assetBaseUrl: active.assetBaseUrl,
  headStyles: getHeadStyles(catalog).map(style => ({ id: style.id, name: style.name.trim(), enabled: style.enabled !== false })),
  ...(catalog.pricing ? { pricing: structuredClone(componentPricingOnly(catalog.pricing)) } : {}),
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
  const [active, draft, activity, storage] = await Promise.all([
    activeCatalog(), db.collection<any>("ring_builder_admin_drafts").findOne({ _id: "store" }),
    db.collection<any>("ring_builder_admin_events").find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(12).toArray(),
    db.collection("ring_builder_assets").aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$bytes" } } }]).toArray(),
  ]);
  return { active: active.catalog, publishedAt: active.updatedAt, draft: draft?.catalog ?? active.catalog, revision: draft?.revision ?? 0, savedAt: draft?.updatedAt ?? null,
    baseReleaseId: draft?.baseReleaseId ?? active.catalog.releaseId, hasDraft: Boolean(draft?.dirty), activity,
    storage: { count: storage[0]?.count ?? 0, bytes: storage[0]?.bytes ?? 0 },
    connections: { database: true, uploads: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCESS_KEY_ID && process.env.CLOUDFLARE_SECRET_ACCESS_KEY && process.env.CLOUDFLARE_BUCKET_NAME && process.env.CLOUDFLARE_R2_PUBLIC_URL) },
  };
};
export const saveDraft = async (input: unknown, revision: number, username: string) => {
  if (!Number.isInteger(revision) || revision < 0) return fail("The draft revision is invalid.");
  const active = (await activeCatalog()).catalog;
  const catalog = checkedCatalog(input, active);
  const drafts = (await database()).collection<any>("ring_builder_admin_drafts");
  if (revision === 0) {
    try { await drafts.insertOne({ _id: "store", revision: 1, baseReleaseId: active.releaseId, catalog, dirty: true, updatedAt: new Date(), updatedBy: username }); }
    catch (error: any) { if (error.code === 11000) return fail("This draft was changed in another window. Reload before saving.", 409); throw error; }
  } else {
    const saved = await drafts.updateOne({ _id: "store", revision }, { $set: { catalog, dirty: true, updatedAt: new Date(), updatedBy: username }, $inc: { revision: 1 } });
    if (!saved.matchedCount) return fail("This draft was changed in another window. Reload before saving.", 409);
  }
  await event("saved", "Catalog draft saved", username);
  return adminState();
};
export const publishDraft = async (revision: number, username: string) => {
  if (!Number.isInteger(revision) || revision < 1) return fail("Save a valid draft before publishing.", 400);
  const client = await mongoClient(), db = await database();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const drafts = db.collection<any>("ring_builder_admin_drafts"), catalogs = db.collection<any>("ring_builder_catalogs");
      const draft = await drafts.findOne({ _id: "store", revision }, { session });
      if (!draft?.dirty) return fail("Save a draft before publishing.", 409);
      const active = await catalogs.findOne({ _id: "active" }, { session });
      if (!active || draft.baseReleaseId !== active.releaseId) return fail("The live catalog changed after this draft started. Refresh and review it before publishing.", 409);
      const catalog = checkedCatalog(draft.catalog, active);
      const releaseId = `admin-${randomUUID()}`, now = new Date();
      const visible = { ...storefrontCatalog(catalog), releaseId };
      await catalogs.insertOne({ _id: `release:${releaseId}`, ...visible, stats: catalogCounts(visible), createdAt: now, publishedBy: username }, { session });
      await catalogs.replaceOne({ _id: "active" }, { ...visible, stats: catalogCounts(visible), updatedAt: now, publishedBy: username }, { session });
      await drafts.updateOne({ _id: "store", revision }, { $set: { catalog: { ...catalog, releaseId }, dirty: false, baseReleaseId: releaseId, updatedAt: now, updatedBy: username }, $inc: { revision: 1 } }, { session });
      await db.collection<any>("ring_builder_admin_events").insertOne({ _id: randomUUID(), type: "published", message: "Catalog published to the ring builder", username, createdAt: now }, { session });
    });
  } finally { await session.endSession(); }
  return adminState();
};
