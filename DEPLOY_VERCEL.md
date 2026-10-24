# Deploy this Ring Builder on Vercel

The cloud upload is complete: 121 assets (33,602,550 bytes) are stored in Cloudflare R2, and MongoDB contains the catalog for 10 diamond shapes, 70 head models, 34 bands and 3 metals. The current asset release is recorded in `src/config/deployment.json`.

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

For future catalog or model changes, use the original local project: update `src/config/catalog.json` and `public/`, run `npm run cloud:sync`, run the checks, build, and run `npm run prepare:vercel`. Upload the new prepared contents to GitHub. Connected Vercel projects deploy new commits automatically.
