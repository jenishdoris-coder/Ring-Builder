import type { IncomingMessage, ServerResponse } from "node:http";
import { setServers } from "node:dns";
import { MongoClient } from "mongodb";
import type { RingCatalog } from "../src/types/catalog";
import { publicCatalog } from "../src/admin/catalog";

type StoredCatalog = RingCatalog & { _id: string; updatedAt?: Date };
const cache = globalThis as typeof globalThis & { __ringBuilderMongo?: Promise<MongoClient> };

const client = () => {
  if (!cache.__ringBuilderMongo) {
    if (process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(",").map(value => value.trim()).filter(Boolean));
    const mongo = new MongoClient(process.env.MONGODB_URI!, { maxPoolSize: 3, minPoolSize: 0, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 12000 });
    cache.__ringBuilderMongo = mongo.connect().catch(async error => { cache.__ringBuilderMongo = undefined; await mongo.close(); throw error; });
  }
  return cache.__ringBuilderMongo;
};

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!process.env.MONGODB_URI) {
    response.setHeader("Cache-Control", "no-store");
    response.writeHead(503).end(JSON.stringify({ error: "Catalog is not configured" }));
    return;
  }
  try {
    const mongo = await client();
    const document = await mongo.db(process.env.MONGODB_DB || undefined).collection<StoredCatalog>("ring_builder_catalogs").findOne({ _id: "active" });
    if (!document?.shapes?.length || !document.shanks?.length || !document.metals?.length) throw new Error("CatalogNotSeeded");
    const { schemaVersion, releaseId, assetBaseUrl, shapes, shanks, metals, defaults, pricing, headStyles } = document;
    const etag = `W/"${releaseId}-${document.updatedAt?.getTime() ?? 0}"`;
    response.setHeader("ETag", etag);
    response.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    response.setHeader("X-Catalog-Source", "mongodb");
    if (request.headers["if-none-match"] === etag) { response.writeHead(304).end(); return; }
    response.writeHead(200).end(request.method === "HEAD" ? undefined : JSON.stringify(publicCatalog({ schemaVersion, releaseId, assetBaseUrl, shapes, shanks, metals, defaults, pricing, headStyles })));
  } catch (error) {
    // Do not send database hosts, credentials, or driver diagnostics to clients.
    console.error("Catalog lookup failed", error instanceof Error ? error.name : "UnknownError");
    response.setHeader("Cache-Control", "no-store");
    response.writeHead(503).end(JSON.stringify({ error: "Catalog temporarily unavailable" }));
  }
}
