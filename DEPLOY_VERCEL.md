# Deploy this Ring Builder on Vercel

Cloudflare R2 hosts the models, environments, icons and pre-rendered head/band thumbnails. MongoDB contains the catalog for 10 diamond shapes, 70 head models, 33 bands and 3 metals. The current asset release is recorded in `src/config/deployment.json`; asset counts and upload details are in the local `artifacts/cloud-sync-report.json`.

1. Open the prepared `vercel-upload` folder, or extract `artifacts/ring-builder-vercel-upload.zip` and open the extracted folder.
2. Open [your GitHub repository](https://github.com/jenishdoris-coder/Ring-Builder). Choose **Add file → Upload files**, or the **uploading an existing file** link on an empty repository.
3. Drag the **contents** of the prepared folder into GitHub. `package.json`, `vercel.json`, `src/`, `api/` and `scripts/` must be at the repository root. Commit the upload to `main`. The prepared folder fits GitHub's [100-file browser upload limit](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).
4. In [Vercel](https://vercel.com/new), select **Add New → Project**, import `jenishdoris-coder/Ring-Builder`, and use the settings below. They are also specified by the included configuration files.

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Root Directory | Repository root (`./`) |
| Node.js | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Node.js 24 is a [supported Vercel runtime](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). The build command explicitly enables production mode.

5. Add these **server-side environment variables** for Production and Preview. Copy their values from `artifacts/vercel-env.private.env` in the original local project. That file is kept outside the prepared upload folder.

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Your existing connection string from the private environment file |
| `MONGODB_DB` | `ring-builder-saanvi` |

Use Vercel's [Environment Variables settings](https://vercel.com/docs/environment-variables/managing-environment-variables) to paste or import the values. Keep the private environment file out of GitHub. `.env.example` contains placeholders and is safe to upload. Cloudflare write keys are only needed for local publishing; public R2 addresses are already configured in the source.

6. Ensure your MongoDB Atlas project's **Network Access** policy permits connections from Vercel Functions. Atlas uses an [IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/). For a restricted list, configure [Vercel Static IPs](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address) and add the assigned outbound addresses to Atlas. A working connection from this computer does not establish access from Vercel.
7. Click **Deploy**. After it finishes, open `https://YOUR-VERCEL-DOMAIN/api/catalog`. It should return JSON containing `schemaVersion: 1`, `shapes`, `shanks` and `metals`. Then open the site, change a head and band, and open an image to check zoom.
8. If `/api/catalog` returns 503, check the two MongoDB variables, the selected environment, Atlas Network Access and the function logs. Redeploy after changing Vercel environment values. The packaged catalog snapshot supports the viewer while the API is unavailable.

The current public asset address uses the configured Cloudflare `r2.dev` hostname. Cloudflare recommends a [custom domain for production traffic](https://developers.cloudflare.com/r2/buckets/public-buckets/). When you attach one to this bucket, update `CLOUDFLARE_R2_PUBLIC_URL` in the local `.env`, run `npm run cloud:sync`, regenerate the upload folder and commit the updated files.

The local project now tracks `main` in the GitHub repository as `origin`. After reviewing changes, commit the source files and push `main` to publish updates. The ignored `.env`, `public/`, dependencies and generated upload folder stay on this computer; public asset URLs and the thumbnail manifest are committed with the source. Connected Vercel projects deploy new commits automatically.

Enable **Web Analytics** and **Speed Insights** in the Vercel project's dashboard, then deploy the updated code. Both React integrations are included and load only in production. Their `/_vercel/` routes are excluded from the SPA fallback. See the official [Web Analytics setup](https://vercel.com/docs/analytics/quickstart) and [Speed Insights setup](https://vercel.com/docs/speed-insights/quickstart). No analytics key or extra environment variable is required.

For future catalog or model changes, use the original local project: update `src/config/catalog.json` and `public/`, run `npm run models:clean` to remove CAD helper geometry (originals are backed up locally), then run `npm run thumbnails:generate`, open the printed local address and click **Generate thumbnails**. Then run `npm run cloud:sync` and commit the updated source and deployment manifest. The generator reuses thumbnails for unchanged model files. `npm run prepare:vercel` remains available for manual GitHub uploads.
