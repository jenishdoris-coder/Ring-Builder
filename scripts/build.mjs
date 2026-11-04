// Existing local .env files may contain NODE_ENV=development.
// Set the production mode before Vite reads them or loads React.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
// Camera tracking is lazy-loaded, but its WASM and decoder files must also be
// present when public/ is disabled for the Cloudflare-hosted model catalog.
const { cp,mkdir } = await import("node:fs/promises");
await cp(new URL("../ar/runtime/", import.meta.url), new URL("../dist/ar/runtime/", import.meta.url), { recursive: true });
await mkdir(new URL('../dist/assets/engraving-font-licenses/',import.meta.url),{recursive:true});
for(const family of ['cormorantgaramond','lato','allura','courierprime'])await cp(new URL(`../src/assets/engraving-fonts/${family}-OFL.txt`,import.meta.url),new URL(`../dist/assets/engraving-font-licenses/${family}-OFL.txt`,import.meta.url));
