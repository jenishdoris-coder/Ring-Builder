import { GetBucketCorsCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { createR2Client, loadCloudEnv, mongoDatabaseName, required, safeError } from "./cloud-env.mjs";

loadCloudEnv();
const checks = await Promise.allSettled([
  (async () => {
    const client = createR2Client(), Bucket = required("CLOUDFLARE_BUCKET_NAME");
    try {
      await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(15000) });
      const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: "ring-builder/", MaxKeys: 1 }));
      let cors;
      try { cors = { readable: true, rules: (await client.send(new GetBucketCorsCommand({ Bucket }))).CORSRules?.length ?? 0 }; }
      catch (error) { cors = { readable: false, error: safeError(error) }; }
      return { service: "Cloudflare R2", connected: true, existingRingBuilderObjects: listed.KeyCount ?? 0, publicUrlConfigured: Boolean(required("CLOUDFLARE_R2_PUBLIC_URL")), cors };
    } finally { client.destroy(); }
  })(),
  (async () => {
    const client = new MongoClient(required("MONGODB_URI"), { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 12000, maxPoolSize: 2 });
    try {
      await client.connect();
      const db = client.db(mongoDatabaseName());
      await db.command({ ping: 1 });
      const existing = await db.listCollections({ name: /^ring_builder_/ }, { nameOnly: true }).toArray();
      return { service: "MongoDB", connected: true, database: db.databaseName, existingRingBuilderCollections: existing.map(item => item.name) };
    } finally { await client.close(); }
  })(),
]);
checks.forEach((check, index) => console.log(JSON.stringify(check.status === "fulfilled" ? check.value : { service: index ? "MongoDB" : "Cloudflare R2", connected: false, error: safeError(check.reason) })));
if (checks.some(check => check.status === "rejected")) process.exitCode = 1;
