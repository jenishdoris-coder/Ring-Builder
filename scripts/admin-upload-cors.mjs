import { mkdir, writeFile } from "node:fs/promises";
import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { createR2Client, loadCloudEnv, required } from "./cloud-env.mjs";
loadCloudEnv();
const origins = (process.env.ADMIN_UPLOAD_ORIGINS || "http://localhost:5173,http://192.168.29.44:5173").split(",").map(value => new URL(value.trim()).origin);
if (origins.includes("null")) throw new Error("Use HTTP or HTTPS admin origins.");
const r2 = createR2Client(), Bucket = required("CLOUDFLARE_BUCKET_NAME");
try {
  const previous = (await r2.send(new GetBucketCorsCommand({ Bucket }))).CORSRules || [];
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/admin-cors-before.json", JSON.stringify(previous, null, 2));
  const rules = previous.filter(rule => rule.ID !== "ring-builder-admin-upload");
  rules.push({ ID: "ring-builder-admin-upload", AllowedOrigins: [...new Set(origins)], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type", "cache-control"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 600 });
  await r2.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
  console.log(JSON.stringify({ adminUploadOrigins: origins, existingReadRulesRetained: true }));
} finally { r2.destroy(); }
