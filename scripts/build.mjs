// Existing local .env files may contain NODE_ENV=development.
// Set the production mode before Vite reads them or loads React.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
// Camera tracking is lazy-loaded, but its WASM and decoder files must also be
// present when public/ is disabled for the Cloudflare-hosted model catalog.
const { cp } = await import("node:fs/promises");
await cp(new URL("../ar/runtime/", import.meta.url), new URL("../dist/ar/runtime/", import.meta.url), { recursive: true });
