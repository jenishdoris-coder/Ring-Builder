import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import deployment from "./src/config/deployment.json";
import { readFileSync } from "node:fs";

const localCatalogApi = (): Plugin => ({
  name: "local-catalog-api",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split("?")[0];
      if (path === "/api/pricing-demo") {
        server.ssrLoadModule("/server/pricingDemo.ts").then(module => module.default(request,response)).catch(() => {
          if (!response.headersSent) response.writeHead(503,{"Content-Type":"application/json","Cache-Control":"no-store"});
          response.end(JSON.stringify({error:"Pricing demo temporarily unavailable"}));
        });
        return;
      }
      if (path !== "/api/catalog" && path !== "/api/admin" && path !== "/api/quote") return next();
      server.ssrLoadModule(`${path}.ts`).then(module => module.default(request, response)).catch(() => {
        if (!response.headersSent) response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Catalog temporarily unavailable" }));
      });
    });
  },
});

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    const environment = loadEnv(mode, process.cwd(), "");
    for (const [name, value] of Object.entries(environment)) if (/^(MONGODB_|CLOUDFLARE_|ADMIN_)/.test(name) && value) process.env[name] = value;
    process.env.MONGODB_DNS_SERVERS ||= "1.1.1.1,8.8.8.8";
  }
  return {
    plugins: [react(), ...(command === "serve" ? [localCatalogApi()] : [])],
    // Hosted assets are served by R2 rather than copied into Vercel's deployment.
    publicDir: command === "build" && deployment.assetBaseUrl ? false : "public",
    server: {
      host: "0.0.0.0", port: process.env.RING_HTTPS === '1' ? 5443 : 5173, strictPort: true,
      ...(process.env.RING_HTTPS === '1' ? { https: { cert: readFileSync('.cert/server.crt.pem'), key: readFileSync('.cert/server.key.pem') } } : {}),
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.cert/**'] },
      watch: { usePolling: true, interval: 300, ignored: ["**/artifacts/**", "**/vercel-upload/**", "**/.cert/**"] },
    },
    resolve: { alias: { webgi: "webgi/dist/examples/runtime/bundle.m.js" }, dedupe: ["react", "react-dom", "three"] },
  };
});
