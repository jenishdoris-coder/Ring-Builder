import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) loadEnvFile(".env");
const deployment = JSON.parse(await readFile("src/config/deployment.json", "utf8"));
const source = JSON.parse(await readFile("src/config/catalog.json", "utf8"));
assert.match(deployment.assetBaseUrl, /^https:\/\//, "Cloudflare assets must be published before deployment");
const headCount = source.shapes.reduce((count, shape) => count + shape.carats.length, 0);
assert.ok(headCount > 0 && source.shanks.length > 0);
assert.ok(deployment.assetCount >= headCount + source.shanks.length + source.shapes.length + 5);
const configuration = JSON.parse(await readFile("vercel.json", "utf8"));
assert.equal(configuration.outputDirectory, "dist");
assert.equal(configuration.framework, "vite");

async function inspect(directory, job) {
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path, job);
    else if (entry.isFile()) await job(path);
  }
}
const secrets = Object.entries(process.env).filter(([name, value]) => /MONGODB_URI|SECRET_ACCESS_KEY|ACCESS_KEY_ID|ADMIN_PASSWORD|JWT_SECRET/.test(name) && value?.length > 10).map(([, value]) => value);
let checked = 0;
for (const directory of ["dist", "vercel-upload"]) await inspect(directory, async path => {
  const body = await readFile(path, "utf8");
  assert.ok(!secrets.some(secret => body.includes(secret)), `A private credential was found in ${path}`);
  assert.ok(!/(?:^|[\\/])\.env(?:$|\.(?!example$))/.test(path), `Private environment file found in ${path}`);
  checked++;
});
assert.ok(!existsSync("dist/models") && !existsSync("dist/metal_env.exr"), "Cloud assets must not be duplicated into the Vercel build");

if (process.argv.includes("--live")) {
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
  const response = await fetch(`${base}/api/catalog`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-catalog-source"), "mongodb");
  const catalog = await response.json();
  assert.equal(catalog.releaseId, deployment.releaseId);
  assert.equal(catalog.shapes.length, source.shapes.length);
  assert.equal(catalog.shanks.length, source.shanks.length);
  assert.equal(catalog.metals.length, source.metals.length);
  assert.equal((await fetch(`${base}/api/catalog`, { method: "POST" })).status, 405, "the public catalog API cannot modify the database");
  assert.equal((await fetch(`${base}/api/catalog`, { headers: { "If-None-Match": response.headers.get("etag") } })).status, 304);
  assert.equal((await fetch(`${base}/api/catalog`, { method: "HEAD" })).status, 200);
  assert.ok(!secrets.some(secret => JSON.stringify(catalog).includes(secret)), "API responses cannot contain credentials");
  for (const path of [source.shapes[0].carats[0].file, "/metal_env.exr", "/images/diamond-shapes/round.webp", "/draco/draco_decoder.wasm"]) {
    const url = `${deployment.assetBaseUrl}/${path.slice(1).split("/").map(encodeURIComponent).join("/")}`;
    const asset = await fetch(url, { method: "HEAD", headers: { Origin: "https://ring-builder-preview.vercel.app" } });
    assert.equal(asset.status, 200, `Remote asset failed: ${path}`);
    assert.equal(asset.headers.get("access-control-allow-origin"), "*");
  }
}
console.log(`Deployment checks passed: configuration, hosted catalog, asset mapping, and ${checked} credential-free build/upload files${process.argv.includes("--live") ? ", MongoDB API, cache validation, read-only methods, and R2 CORS" : ""}.`);
