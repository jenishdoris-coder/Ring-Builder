import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import deployment from "./src/config/deployment.json";

const localCatalogApi = (): Plugin => ({
  name: "local-catalog-api",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== "/api/catalog") return next();
      server.ssrLoadModule("/api/catalog.ts").then(module => module.default(request, response)).catch(() => {
        if (!response.headersSent) response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Catalog temporarily unavailable" }));
      });
    });
  },
});

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    const environment = loadEnv(mode, process.cwd(), "");
    for (const name of ["MONGODB_URI", "MONGODB_DB", "MONGODB_DNS_SERVERS"]) if (environment[name]) process.env[name] = environment[name];
    process.env.MONGODB_DNS_SERVERS ||= "1.1.1.1,8.8.8.8";
  }
  return {
    plugins: [react(), ...(command === "serve" ? [localCatalogApi()] : [])],
    // Hosted assets are served by R2 rather than copied into Vercel's deployment.
    publicDir: command === "build" && deployment.assetBaseUrl ? false : "public",
    server: {
      host: "0.0.0.0", port: 5173, strictPort: true,
      watch: { usePolling: true, interval: 300, ignored: ["**/artifacts/**", "**/vercel-upload/**"] },
    },
    resolve: { alias: { webgi: "webgi/dist/examples/runtime/bundle.m.js" } },
  };
});
