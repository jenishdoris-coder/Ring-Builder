import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { database } from "../server/db";
import { adminConfigured, equal, newSession, passwordMatches, readSession, sameOrigin, writeSessionCookie } from "../server/adminAuth";
import { AdminError, adminState, fail, publishDraft, saveDraft } from "../server/adminStore";
import { beginUpload, finishUpload } from "../server/adminUploads";
import { publicCatalog, storefrontCatalog } from "../src/admin/catalog";

const body = async (request: IncomingMessage) => {
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    if (JSON.stringify(parsed).length > 1024 * 1024) return fail("Request too large.", 413);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024) return fail("Request too large.", 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return fail("Invalid JSON."); }
};
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const send = (value: unknown, status = 200) => response.writeHead(status).end(JSON.stringify(value));
  try {
    const url = new URL(request.url!, "http://admin.local"), action = url.searchParams.get("action") || "session";
    const method = request.method;
    if (method !== "GET" && method !== "POST") { response.setHeader("Allow", "GET, POST"); return send({ error: "Method not allowed" }, 405); }
    if (method === "POST" && (!sameOrigin(request) || !request.headers["content-type"]?.startsWith("application/json"))) return fail("This request must come from the admin panel.", 403);
    if (action === "session" && method === "GET") return send({ configured: adminConfigured(), session: readSession(request) });
    if (!adminConfigured()) return fail("Run npm run admin:setup in the project folder to configure admin access.", 503);
    if (action === "login" && method === "POST") {
      const input = await body(request) as any;
      if (typeof input?.username !== "string" || typeof input.password !== "string" || input.username.length > 100 || input.password.length > 256) return fail("Enter your admin username and password.");
      const db = await database();
      const address = process.env.VERCEL ? String(request.headers["x-forwarded-for"] || "unknown").split(",")[0] : request.socket.remoteAddress || "local";
      const id = createHash("sha256").update(`${address}:${Math.floor(Date.now() / 900000)}`).digest("hex");
      const attempts = db.collection<any>("ring_builder_admin_attempts");
      const attempt = await attempts.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 900000) } }, { upsert: true, returnDocument: "after" });
      if (attempt!.count > 10) return fail("Too many sign-in attempts. Try again in 15 minutes.", 429);
      if (!passwordMatches(input.username, input.password)) return fail("The username or password is incorrect.", 401);
      const session = newSession();
      writeSessionCookie(request, response, session.cookie);
      return send({ session: session.session });
    }
    const session = readSession(request);
    if (!session) return fail("Please sign in to continue.", 401);
    if (method === "POST" && (typeof request.headers["x-admin-csrf"] !== "string" || !equal(request.headers["x-admin-csrf"], session.csrf))) return fail("Your session changed. Reload and try again.", 403);
    if (action === "logout" && method === "POST") { writeSessionCookie(request, response, "", true); return send({ ok: true }); }
    if (action === "state" && method === "GET") return send(await adminState());
    if (action === "preview" && method === "GET") {
      const state = await adminState();
      return send(publicCatalog(storefrontCatalog({ ...state.draft,releaseId:`${state.draft.releaseId}-draft-${state.revision}` })));
    }
    if (action === "assets" && method === "GET") {
      const search = (url.searchParams.get("search") || "").slice(0, 100), page = Math.max(0, Math.min(10000, Number(url.searchParams.get("page")) || 0));
      const filter = search ? { sourcePath: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {};
      const assets = (await database()).collection("ring_builder_assets");
      const [items, total] = await Promise.all([assets.find(filter, { projection: { _id: 0, key: 0, sha256: 0 } }).sort({ createdAt: -1, sourcePath: 1 }).skip(Math.floor(page) * 30).limit(30).toArray(), assets.countDocuments(filter)]);
      return send({ items, total });
    }
    const input = method === "POST" ? await body(request) as any : {};
    if (action === "save" && method === "POST") return send(await saveDraft(input.catalog, input.revision, session.username));
    if (action === "publish" && method === "POST") return send(await publishDraft(input.revision, session.username));
    if (action === "upload" && method === "POST") return send(await beginUpload(input, session.username));
    if (action === "upload-complete" && method === "POST") return send(await finishUpload(input.id, session.username));
    return fail("Admin action not found.", 404);
  } catch (error) {
    if (!(error instanceof AdminError)) console.error("Admin request failed", error instanceof Error ? error.name : "UnknownError");
    return send({ error: error instanceof AdminError ? error.message : "The request could not be completed. Please try again." }, error instanceof AdminError ? error.status : 500);
  }
}
