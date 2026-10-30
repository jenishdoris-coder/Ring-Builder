import type { IncomingMessage, ServerResponse } from "node:http";
import type { PriceSelection } from "../src/types/pricing.js";
import { database } from "../server/db.js";
import { readSession, sameOrigin } from "../server/adminAuth.js";
import { quoteRing } from "../src/utils/ringPricing.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const send = (status: number, value: unknown) => response.writeHead(status).end(JSON.stringify(value));
  if (request.method !== "POST" && request.method !== "GET") { response.setHeader("Allow", "GET, POST"); return send(405, { error: "Method not allowed" }); }
  if (request.method === "POST" && (!sameOrigin(request) || !request.headers["content-type"]?.startsWith("application/json"))) return send(403, { error: "Invalid request origin" });
  try {
    const url = new URL(request.url!, "http://ring.local");
    let input = (request as IncomingMessage & { body?: unknown }).body;
    if (request.method === "GET") {
      if (url.search.length > 4096) return send(413, { error: "Request too large" });
      input = { ...Object.fromEntries(url.searchParams), carat: Number(url.searchParams.get("carat")) };
    } else if (input === undefined) {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 4096) return send(413, { error: "Request too large" }); chunks.push(chunk); }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } else if (typeof input === "string") input = JSON.parse(input);
    if (!input || JSON.stringify(input).length > 4096) return send(400, { error: "Invalid selection" });
    const s = input as PriceSelection;
    if ([s.shapeId,s.headStyleId,s.bandId,s.headMetalId,s.bandMetalId].some(value => typeof value !== "string" || !/^[a-z0-9_-]{1,100}$/.test(value)) || typeof s.size !== "string" || s.size.length > 16 || !Number.isFinite(s.carat) || s.carat <= 0 || s.carat > 25) return send(400, { error: "Invalid selection" });
    const draft = url.searchParams.get("preview") === "draft";
    if (draft && !readSession(request)) return send(401, { error: "Sign in to preview draft pricing" });
    const db = await database();
    const document = draft ? await db.collection<any>("ring_builder_admin_drafts").findOne({ _id:"store" }) : null;
    const catalog = document?.catalog || await db.collection<any>("ring_builder_catalogs").findOne({ _id:"active" });
    if (!catalog?.pricing?.enabled) return send(200, { total:null, currency:catalog?.pricing?.currency || "USD", enabled:false });
    const quote = quoteRing(catalog,s);
    // Never disclose material costs, weight tables, margins or the multiplier.
    return send(200, { total:quote.total, currency:quote.currency, enabled:true });
  } catch (error) { if (error instanceof SyntaxError) return send(400,{error:"Invalid selection"}); console.error("Price quote failed", error instanceof Error ? error.name : "UnknownError"); return send(503, { error:"Price is temporarily unavailable" }); }
}
