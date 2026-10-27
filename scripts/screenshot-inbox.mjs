import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = join(project, "artifacts", "incoming-screenshots");
const port = Number(process.env.SCREENSHOT_INBOX_PORT || 5174);
const maxBytes = 20 * 1024 * 1024;
await mkdir(folder, { recursive: true });
const base = "/";
const html = await readFile(new URL("./screenshot-inbox.html", import.meta.url));
const send = (response, status, data) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
};
const imageType = bytes => {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ["png", "image/png"];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ["jpg", "image/jpeg"];
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return ["gif", "image/gif"];
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return ["webp", "image/webp"];
};
const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  try {
    const url = new URL(request.url, "http://localhost");
    if (/^\/inbox\/[a-f0-9]{32}\/?$/.test(url.pathname)) {
      response.writeHead(302, { Location: "/" });
      return response.end();
    }
    const route = url.pathname.slice(base.length);
    if (request.method === "GET" && !route) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(html);
    }
    if (request.method === "GET" && route === "files") {
      const names = (await readdir(folder)).filter(name => name.endsWith(".json")).sort().reverse().slice(0, 60);
      const items = await Promise.all(names.map(async name => {
        try { return JSON.parse(await readFile(join(folder, name), "utf8")); } catch { return null; }
      }));
      return send(response, 200, { folder, items: items.filter(Boolean) });
    }
    if (request.method === "POST" && route === "upload") {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return send(response, 403, { error: "Use this upload page to send screenshots." });
      if (Number(request.headers["content-length"]) > maxBytes) return send(response, 413, { error: "Choose an image smaller than 20 MB." });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) return send(response, 413, { error: "Choose an image smaller than 20 MB." });
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const type = imageType(bytes);
      if (!type) return send(response, 415, { error: "Choose a PNG, JPG, WebP or GIF image." });
      const originalName = decodeURIComponent(String(request.headers["x-file-name"] || "screenshot")).slice(0, 200);
      const note = decodeURIComponent(String(request.headers["x-screenshot-note"] || "")).slice(0, 2000);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const stem = originalName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "screenshot";
      const filename = `${stamp}_${stem}_${randomBytes(3).toString("hex")}.${type[0]}`;
      const item = { filename, originalName, note, uploadedAt: new Date().toISOString(), bytes: size, path: join(folder, filename) };
      await writeFile(item.path, bytes, { flag: "wx" });
      await writeFile(join(folder, `${filename}.json`), JSON.stringify(item, null, 2), { flag: "wx" });
      console.log(`Received: ${filename}${note ? ` — ${note.replace(/[\r\n]/g, " ")}` : ""}`);
      return send(response, 201, item);
    }
    if (request.method === "GET" && route.startsWith("image/")) {
      const filename = route.slice(6);
      if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|webp|gif)$/.test(filename)) return send(response, 404, { error: "Image not found." });
      const bytes = await readFile(join(folder, filename));
      const type = imageType(bytes);
      if (!type) return send(response, 404, { error: "Image not found." });
      response.writeHead(200, { "Content-Type": type[1], "Content-Length": bytes.length, "Cache-Control": "private, max-age=3600" });
      return response.end(bytes);
    }
    send(response, 404, { error: "Page not found." });
  } catch (error) {
    if (!response.headersSent) send(response, error.code === "ENOENT" ? 404 : 500, { error: error.code === "ENOENT" ? "Image not found." : "Upload failed. Please try again." });
    else response.end();
  }
});
server.requestTimeout = 120_000;
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. The inbox may already be running.` : error.message); process.exitCode = 1; });
server.listen(port, "0.0.0.0", () => {
  console.log(`Screenshot Inbox\nLocal: http://localhost:${port}${base}`);
  for (const addresses of Object.values(networkInterfaces())) for (const address of addresses || []) {
    if (address.family === "IPv4" && !address.internal) console.log(`Laptop: http://${address.address}:${port}${base}`);
  }
  console.log(`Saved to: ${folder}`);
});
