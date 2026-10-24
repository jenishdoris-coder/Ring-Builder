import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { GetBucketCorsCommand, HeadObjectCommand, PutBucketCorsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { createR2Client, loadCloudEnv, mongoDatabaseName, required, safeError } from "./cloud-env.mjs";

loadCloudEnv();
const root = resolve("public");
const source = JSON.parse(await readFile("src/config/catalog.json", "utf8"));
const sha256 = data => createHash("sha256").update(data).digest("hex");
const types = { ".glb": "model/gltf-binary", ".exr": "image/x-exr", ".webp": "image/webp", ".png": "image/png", ".js": "application/javascript", ".wasm": "application/wasm", ".json": "application/json" };
async function inventory(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(absolute));
    else if (entry.isFile()) {
      const body = await readFile(absolute);
      files.push({ absolute, path: relative(root, absolute).replaceAll("\\", "/"), bytes: body.length, sha256: sha256(body), contentType: types[extname(entry.name).toLowerCase()] || "application/octet-stream" });
    }
  }
  return files;
}
const files = (await inventory(root)).sort((a, b) => a.path.localeCompare(b.path));
if (!files.length) throw new Error("No public assets found. Run this command from the original project folder.");
const releaseId = sha256(JSON.stringify({ catalog: source, files: files.map(file => [file.path, file.sha256]) })).slice(0, 16);
const prefix = `ring-builder/releases/${releaseId}`;
const publicBase = required("CLOUDFLARE_R2_PUBLIC_URL").replace(/\/+$/, "");
if (new URL(publicBase).protocol !== "https:") throw new Error("CLOUDFLARE_R2_PUBLIC_URL must be an HTTPS public bucket URL.");
const assetBaseUrl = `${publicBase}/${prefix}`;
const urlFor = path => `${assetBaseUrl}/${path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/")}`;
const localFiles = new Set(files.map(file => `/${file.path}`));
for (const path of [...source.shapes.flatMap(shape => shape.carats.map(carat => carat.file)), ...source.shanks.map(shank => shank.file), "/metal_env.exr", "/diamond_env.exr", ...source.shapes.map(shape => `/images/diamond-shapes/${shape.id}.webp`), "/draco/draco_decoder.wasm", "/draco/draco_wasm_wrapper.js"]) {
  if (!localFiles.has(path)) throw new Error(`Required asset is missing: ${path}`);
}
const catalog = {
  schemaVersion: 1, releaseId, assetBaseUrl,
  shapes: source.shapes.map(shape => ({ ...shape, carats: shape.carats.map(carat => ({ ...carat, file: urlFor(carat.file) })) })),
  shanks: source.shanks.map(shank => ({ ...shank, file: urlFor(shank.file) })),
  metals: source.metals, defaults: source.defaults,
};
const stats = { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), shapes: source.shapes.length, heads: source.shapes.reduce((sum, shape) => sum + shape.carats.length, 0), shanks: source.shanks.length, metals: source.metals.length };
console.log(JSON.stringify({ stage: "inventory", releaseId, ...stats }));
await mkdir("artifacts", { recursive: true });

async function concurrent(items, count, job) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) { const index = next++; await job(items[index], index); }
  }));
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function verifyPublic(file) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(urlFor(file.path), { method: "HEAD", headers: { Origin: "https://ring-builder-preview.vercel.app" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Public asset returned HTTP ${response.status}: ${file.path}`);
      if (Number(response.headers.get("content-length")) !== file.bytes) throw new Error(`Public asset size mismatch: ${file.path}`);
      const cors = response.headers.get("access-control-allow-origin");
      if (cors !== "*" && cors !== "https://ring-builder-preview.vercel.app") throw new Error(`Public asset CORS is missing: ${file.path}`);
      return;
    } catch (error) { if (attempt === 3) throw error; await sleep(500 * (attempt + 1)); }
  }
}

const r2 = createR2Client();
const mongo = new MongoClient(required("MONGODB_URI"), { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, maxPoolSize: 3 });
try {
  // Check database access before uploading; never drop collections or delete bucket objects.
  await mongo.connect();
  const db = mongo.db(mongoDatabaseName());
  await db.command({ ping: 1 });
  const Bucket = required("CLOUDFLARE_BUCKET_NAME");
  let rules = [];
  try { rules = (await r2.send(new GetBucketCorsCommand({ Bucket }))).CORSRules ?? []; }
  catch (error) { if (error.name !== "NoSuchCORSConfiguration") throw error; }
  await writeFile("artifacts/cloud-cors-before.json", JSON.stringify(rules, null, 2));
  if (!rules.some(rule => rule.AllowedOrigins?.includes("*") && ["GET", "HEAD"].every(method => rule.AllowedMethods?.includes(method)))) {
    rules.push({ ID: "ring-builder-public-read", AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag", "Content-Length", "Content-Type", "Accept-Ranges", "Content-Range"], MaxAgeSeconds: 86400 });
    await r2.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
  }
  let uploaded = 0, skipped = 0, completed = 0;
  await concurrent(files, 4, async file => {
    const Key = `${prefix}/${file.path}`;
    let matches = false;
    try { const head = await r2.send(new HeadObjectCommand({ Bucket, Key })); matches = head.ContentLength === file.bytes && head.Metadata?.sha256 === file.sha256; }
    catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
    if (matches) skipped++;
    else {
      await r2.send(new PutObjectCommand({ Bucket, Key, Body: await readFile(file.absolute), ContentLength: file.bytes, ContentType: file.contentType, CacheControl: "public, max-age=31536000, immutable", Metadata: { sha256: file.sha256, release: releaseId } }));
      uploaded++;
    }
    completed++;
    if (completed % 20 === 0 || completed === files.length) console.log(JSON.stringify({ stage: "r2-upload", completed, total: files.length, uploaded, skipped }));
  });
  await concurrent(files, 4, verifyPublic);
  console.log(JSON.stringify({ stage: "public-verification", verified: files.length, cors: "passed" }));
  const assetRecords = files.map(file => ({ _id: `${releaseId}:${file.path}`, releaseId, sourcePath: `/${file.path}`, key: `${prefix}/${file.path}`, url: urlFor(file.path), bytes: file.bytes, sha256: file.sha256, contentType: file.contentType }));
  await db.collection("ring_builder_assets").bulkWrite(assetRecords.map(record => ({ updateOne: { filter: { _id: record._id }, update: { $setOnInsert: record }, upsert: true } })), { ordered: false });
  const catalogs = db.collection("ring_builder_catalogs");
  await catalogs.updateOne({ _id: `release:${releaseId}` }, { $setOnInsert: { ...catalog, stats, createdAt: new Date() } }, { upsert: true });
  await catalogs.replaceOne({ _id: "active" }, { ...catalog, stats, updatedAt: new Date() }, { upsert: true });
  const stored = await catalogs.findOne({ _id: "active" });
  const storedAssets = await db.collection("ring_builder_assets").countDocuments({ releaseId });
  if (stored?.releaseId !== releaseId || storedAssets !== files.length) throw new Error("MongoDB verification failed.");
  await writeFile("src/config/deployment.json", JSON.stringify({ releaseId, assetBaseUrl, assetCount: files.length }, null, 2) + "\n");
  await writeFile("artifacts/vercel-env.private.env", `MONGODB_URI=${JSON.stringify(required("MONGODB_URI"))}\nMONGODB_DB=${JSON.stringify(db.databaseName)}\n`, { mode: 0o600 });
  const report = { completedAt: new Date().toISOString(), releaseId, assetBaseUrl, database: db.databaseName, collections: ["ring_builder_catalogs", "ring_builder_assets"], uploaded, skipped, verifiedAssets: files.length, ...stats };
  await writeFile("artifacts/cloud-sync-report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "complete", ...report }));
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
finally { r2.destroy(); await mongo.close(); }
