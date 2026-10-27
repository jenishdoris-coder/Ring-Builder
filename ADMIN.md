# Store admin

Open `/admin` on the deployed storefront, or `http://localhost:5173/admin` for local development. Configure the same server variables in Vercel before deploying; see [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md). Local admin access is configured in `.env`; the private sign-in details are in `artifacts/admin-access.private.txt` and are excluded from Git.

## Workflow

1. Use **Bands**, **Heads & shapes**, or **Metals** to edit your real catalog. Apply editor changes, then **Save draft**. Hide items using their availability switch. A default item must be replaced in Builder settings before it can be hidden.
2. Add head setting styles before uploading their models. A head is identified by setting style, diamond shape and center carat size. The existing collection is retained as 4-Prong Talon. Another style, such as Hidden Halo, needs its own uploaded models; no sample models are created.
3. Upload GLB 2.0 models directly to Cloudflare. A small selector thumbnail is generated once in the admin browser and uploaded with the model. If generation fails, add an image manually. The customer's three ring photos remain dynamic.
4. Save and **Preview saved draft** from Review & publish. This opens the real configurator with a draft banner and requires your admin session.
5. **Publish to builder** changes the MongoDB catalog, retaining the previous catalog as a release snapshot. It does not deploy code. Publishing is transactional and rejects conflicting revisions or a live catalog that changed since the draft began. The public catalog cache may take five minutes to refresh.

**Delete** is available for bands, head models and metals, and inside the shape and head-setting editors. The confirmation shows dependent head models and any replacement defaults. Deletion removes the item and its associated price records from the draft, retaining uploaded files in the asset library. The last available band, metal or head model cannot be deleted. The toolbar **Undo** restores recent catalog changes in the current admin session, including staged deletions. Save the draft and publish only when ready.

Storefront tabs refresh their catalog when focused again or restored from browser history. Admin saves notify open draft previews; admin publishing notifies regular storefront tabs. Draft previews use revision-specific catalog IDs so changing only a rate also refreshes its quote. A signed-out draft preview falls back to published configuration and pricing with a sign-in notice, rather than silently showing the unpriced bootstrap catalog.

**Do not publish an admin draft merely to test this local panel:** MongoDB is shared with the live storefront. Local code changes and saving drafts do not change the active storefront catalog.

## Pricing

Choose a currency (USD by default). Changing it relabels entered amounts and does not convert currencies. Gold is priced per gram of the selected metal; diamonds are priced per carat. Each catalog metal/color has its own rate, so adding a 14K, 18K or 20K metal automatically adds a pricing row. No market prices or model weights are invented.

The component calculation is:

```
Center = selected center carats × center diamond rate per carat
Head   = head gold grams × head metal rate + head accent carats × accent diamond rate + head finish charge
Band   = band gold grams × band metal rate + band accent carats × accent diamond rate + band finish charge
Total  = (Center + Head + Band) × master multiplier
```

- Head weight rows follow the center diamond's actual carat sizes for each setting style. Enter the **total setting weight, including all prongs**, without counting the center diamond again. Style defaults cover every shape; optional shape overrides handle different head geometry.
- Band weight rows follow the configured ring sizes for each band. Enter measured weights for each size. The explicit copy button can reuse values across sizes; no linear weight scaling or interpolation is assumed.
- Gold and accent weights remain the same across metal/color choices. Material rates and optional per-part finish charges change the amount.
- An explicit `0` accent carat value means no accent diamonds. A blank field remains unconfigured.
- Each head or band row may instead use a **fixed component price**, with optional metal/color overrides. That component's material and finish costs are not added again. The center diamond is still included separately.
- There is no whole-ring price override. The final price always comes from the selected center diamond, head and band, with the master multiplier applied once to their combined total.
- The common accent diamond rate falls back to the common center rate when blank. Center rates may be overridden by shape and carat.
- The multiplier applies once, after adding the components; only the final amount is rounded to the selected currency's minor unit.
- Pricing starts hidden. Enable it after entering your rates and weights. Incomplete selections show **Price on request**, rather than an invented zero.

The live calculator evaluates unsaved local edits. Draft previews and the customer builder request final prices from `/api/quote`; costs, weight tables and the multiplier are excluded from the public catalog and quote response. A later checkout integration must request a fresh server quote rather than accepting an amount from the browser.

### Local storefront pricing demo

Open `http://localhost:5173/?demo=pricing` while Vite is running. This uses the real model catalog with explicitly fictional USD rates and weights held in memory. The default 2 ct Traditional Solitaire in white gold, size 7, demonstrates a $2,800.00 total; size 8 demonstrates $2,811.25. Change the center carat, head, band, metals or ring size to see the price update. The banner labels these as sample prices, and **Exit demo** returns to the regular storefront.

The `/api/pricing-demo` endpoint is registered only by the local Vite development server. It does not save drafts, change MongoDB prices or publish anything. Production builds ignore the demo query parameter.

To explicitly populate the admin draft with these sample defaults, run `node scripts/fill-admin-sample-pricing.mjs`. This backs up the previous draft under `artifacts/`, fills rates and weight rows for all existing models and configured sample sizes, and leaves the live catalog unchanged. It creates no center-rate, shape-specific or metal-specific price overrides. These are fictional demonstration values, not measured model weights or market prices.

## Server setup

`npm run admin:setup` creates credentials only if needed. Existing credentials are retained. Restart Vite after environment changes.

The server uses `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `MONGODB_URI`, `MONGODB_DB` and the existing `CLOUDFLARE_*` variables. None should have a `VITE_` prefix. Sessions use signed, expiring HttpOnly cookies, same-origin mutations and CSRF tokens; sign-in attempts are limited per address and time window.

`npm run admin:cors` configures signed browser uploads for exact origins in `ADMIN_UPLOAD_ORIGINS`, preserving existing public read rules. The production origin is `https://ring-builder-lake.vercel.app`; local origins are localhost and `192.168.29.44`, both on port 5173. Add any new deployment domain explicitly and rerun this command before uploading from it. Uploads go directly to R2; credentials remain on the server. Uploaded formats and sizes are checked before indexing.

Collections: `ring_builder_catalogs`, `ring_builder_assets`, `ring_builder_admin_drafts`, `ring_builder_admin_events`, `ring_builder_admin_uploads` and `ring_builder_admin_attempts`.

## Checks

```
npm run check
npm run test:admin
npm run build
```

The focused admin checks cover authentication, origins, catalog validation, setting variants, price formulas, size/color overrides, fixed modes and private/public data separation. No tests publish the active store catalog.
