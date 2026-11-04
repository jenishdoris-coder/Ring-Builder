import { createHash, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { database } from "./db.js";
import { event, fail } from "./adminStore.js";

const client = () => {
  const names = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCESS_KEY_ID", "CLOUDFLARE_SECRET_ACCESS_KEY", "CLOUDFLARE_BUCKET_NAME", "CLOUDFLARE_R2_PUBLIC_URL"];
  if (names.some(name => !process.env[name])) return fail("Cloudflare uploads are not configured. Add the server-side R2 variables.", 503);
  return new S3Client({ region: "auto", endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID!, secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY! }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
};
export const beginUpload = async (input: any, username: string) => {
  const { filename, bytes, kind, idempotencyKey, modelFile } = input;
  const image = kind === "image";
  if (kind !== "model" && !image) return fail("Choose a model or image upload.");
  if (typeof filename !== "string" || filename.length > 240 || !Number.isInteger(bytes) || bytes <= 0 || bytes > (image ? 10 : 100) * 1024 * 1024) return fail(`Choose a ${image ? "PNG, JPG or WebP below 10 MB" : "GLB below 100 MB"}.`);
  const extension = filename.split(".").pop()?.toLowerCase();
  const contentType = image ? ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[extension!] : extension === "glb" ? "model/gltf-binary" : undefined;
  if (!contentType) return fail("The file format is not supported.");
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 8192 || !image)) return fail('The upload resume key is invalid.');
  const publicBase=process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/,'');
  if(modelFile!==undefined&&(typeof modelFile!=='string'||!modelFile.startsWith(`${publicBase}/ring-builder/`)||!modelFile.endsWith('.glb')||modelFile.length>2048||!image))return fail('The thumbnail model reference is invalid.');
  if(modelFile&&await (await database()).collection('ring_builder_asset_deletions').findOne({url:modelFile,status:{$in:['pending','deleting','deleted']}}))return fail('This model was deleted. Upload it again before generating thumbnails.',409);
  const digest = idempotencyKey ? createHash('sha256').update(`${username}\0${idempotencyKey}`).digest('hex') : '';
  const id = digest ? `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}` : randomUUID();
  const name = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `ring-builder/admin/${id}/${name}`;
  const r2 = client();
  try {
    const uploads = (await database()).collection<any>('ring_builder_admin_uploads');
    const previous = idempotencyKey ? await uploads.findOne({ _id: id, username }) : undefined;
    if (previous && (previous.bytes !== bytes || previous.filename !== filename || previous.kind !== kind)) return fail('The saved upload differs from this image. Generate it again with a new resume key.', 409);
    if (previous?.completedAt) return { id, contentType, asset: { url: previous.url, filename: previous.filename } };
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: process.env.CLOUDFLARE_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: bytes, CacheControl: "public, max-age=31536000, immutable" }), { expiresIn: 600 });
    const url = `${process.env.CLOUDFLARE_R2_PUBLIC_URL!.replace(/\/+$/, "")}/${key}`;
    await uploads.updateOne({ _id: id }, { $setOnInsert: { key, url, bytes, filename, contentType, kind, username, createdAt: new Date(),...(modelFile?{modelFile}:{}) }, $set: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) } }, { upsert: true });
    return { id, uploadUrl, contentType };
  } finally { r2.destroy(); }
};
export const finishUpload = async (id: unknown, username: string) => {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return fail("The upload ID is invalid.");
  const db = await database();
  const ticket = await db.collection<any>("ring_builder_admin_uploads").findOne({ _id: id, username, expiresAt: { $gt: new Date() } });
  if (!ticket) return fail("This upload expired. Choose the file again.", 410);
  const r2 = client(), Bucket = process.env.CLOUDFLARE_BUCKET_NAME;
  try {
    const object = await r2.send(new HeadObjectCommand({ Bucket, Key: ticket.key }));
    if (object.ContentLength !== ticket.bytes || object.ContentType !== ticket.contentType) return fail("The uploaded file does not match its expected size or format.");
    const header = await r2.send(new GetObjectCommand({ Bucket, Key: ticket.key, Range: "bytes=0-19" }));
    const bytes = Buffer.from(await header.Body!.transformToByteArray());
    if (ticket.kind === "model") {
      if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== ticket.bytes) return fail("This is not a complete GLB 2.0 file.");
    } else {
      const valid = ticket.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ticket.contentType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      if (!valid) return fail("The image contents do not match its file extension.");
    }
    const record = { _id: `admin:${id}`, releaseId: "admin", sourcePath: ticket.filename, key: ticket.key, url: ticket.url, bytes: ticket.bytes, contentType: ticket.contentType, createdAt: new Date(), uploadedBy: username,...(ticket.modelFile?{modelFile:ticket.modelFile}:{}) };
    await db.collection<any>("ring_builder_assets").updateOne({ _id: record._id }, { $setOnInsert: record }, { upsert: true });
    if (!ticket.completedAt) await event("uploaded", `Uploaded ${ticket.filename}`, username);
    await db.collection<any>("ring_builder_admin_uploads").updateOne({ _id: id }, { $set: { completedAt: new Date() } });
    return { url: ticket.url, filename: ticket.filename, bytes: ticket.bytes, contentType: ticket.contentType };
  } finally { r2.destroy(); }
};
