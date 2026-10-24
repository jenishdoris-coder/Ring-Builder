# Saanvi Ring Builder

React, Vite and WebGI ring configurator with whole-ring dissolve transitions, a live 3D canvas, 1200 × 1200 generated views, image zoom and a responsive product configurator.

The models, lighting environments, diamond icons and Draco decoders are hosted on Cloudflare R2. A read-only Vercel function at `/api/catalog` reads the catalog from MongoDB. A packaged catalog snapshot keeps the configurator usable while the API connects.

See [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for the GitHub drag-and-drop and Vercel deployment steps.

## Local development

Use Node.js 24. Keep the configured `.env` in the original local project folder.

```sh
npm ci
npm run dev
```

The development server also serves `/api/catalog`. Production API requests run as Vercel Functions.

## Publishing data

```sh
npm run cloud:check
npm run cloud:sync
```

These commands read MongoDB and Cloudflare credentials from `.env`. The sync command inventories `public/`, uploads assets to an immutable, project-specific R2 release, verifies public access and CORS, then publishes the MongoDB catalog. Rerunning the same release skips matching uploads. Existing bucket objects and unrelated database collections are retained.

The database collections are `ring_builder_catalogs` and `ring_builder_assets`. `src/config/deployment.json` contains the public asset base URL; it contains no credentials. Change catalog entries in `src/config/catalog.json` and rerun the sync before publishing changes.

```sh
npm run check
npm run test:animation
npm run test:gallery
npm run build
npm run test:deployment -- --live
npm run prepare:vercel
```

`prepare:vercel` creates a clean `vercel-upload/` folder for GitHub. Private environment files, installed dependencies, local assets and generated previews are excluded. The original project retains the local assets for future publishing.

Cloudflare write credentials stay in the local `.env`. Vercel needs the server-side MongoDB variables listed in the deployment guide. Keep all credential variables free of the `VITE_` prefix.
