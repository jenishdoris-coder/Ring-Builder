// Existing local .env files may contain NODE_ENV=development.
// Set the production mode before Vite reads them or loads React.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
