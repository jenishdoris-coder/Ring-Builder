# Saanvi Ring Builder

React, Vite and WebGI ring configurator with whole-ring dissolve transitions, a live 3D canvas, 1200 × 1200 generated views, image zoom and a responsive product configurator.

The models, lighting environments, diamond icons, static model thumbnails and Draco decoders are hosted on Cloudflare R2. A read-only Vercel function at `/api/catalog` reads the catalog from MongoDB. A packaged catalog snapshot keeps the configurator usable while the API connects. Vercel Web Analytics and Speed Insights are integrated for production deployments; enable both in the project's Vercel dashboard.

See [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for the GitHub drag-and-drop and Vercel deployment steps.

## Local development

Use Node.js 24. Keep the configured `.env` in the original local project folder.

```sh
npm ci
npm run dev
```

The development server also serves `/api/catalog`. Production API requests run as Vercel Functions.

The live viewer has a three-quarter view, a larger top view aligned with the ring, a head-and-prongs close-up, and a shank-diamond close-up. Detail framing follows the selected model geometry and pauses rotation. For plain bands, the shank close-up shows the metal shoulder. View changes requested while gallery photos are being captured run after the live ring pose is restored.

The live canvas fills its tile, and the default camera centres and fits the complete selected assembly with room for rotation. Close-ups crop at the tile's outer edge. Product photos fit actual geometry at 1200 × 1200 with four subpixel samples and maximum-quality WebP encoding; tighter framing adds visible detail without increasing resolution. The studio uses subtle SSAO, and transparent diamonds do not cast opaque screen-space occlusion onto the setting. The separate contact-shadow floor remains active.

Diamond and side photos centre the projected ring outline in the image, preserving their viewing angles, size and floor contact. The same framing is used for their higher-resolution zoom versions.

On screens up to 850px wide, the live viewer fills a square tile above a single row of three square photo thumbnails. Canvas controls form a horizontal bar at the bottom. A floating scroll prompt takes the shopper to the customization options and disappears after scrolling. Drag and pinch gestures stay captured by the canvas after model/photo updates; touching the viewer pauses default rotation until 2.5 seconds after release. The engraving-position cards use static renders of the actual ring with the inscription area highlighted; these are generated once rather than rendered on each visit. Head and band metal selectors are labelled separately.

Photos open immediately from their existing preview with a 360ms expansion from the tapped thumbnail and close with a reverse transition. Image scaling compensates for the frame's shape change to preserve the ring's proportions. High-resolution generation starts after the opening animation completes, and closing cancels unfinished enhancement. Reduced-motion preferences skip the transitions. Image touch controls support pinch/pan and double-tap zoom.

Desktop and mobile live rendering use the renderer's temporal anti-aliasing. Desktop pixel density is 2; mobile pixel density is capped at 2. The 1200px gallery uses four subpixel samples on both desktop and mobile; enlarged photos use eight samples. Photo clipping planes fit the actual assembly and floor to improve depth precision around thin metal edges. Sampling yields between frames so closing can cancel unfinished work, and temporary accumulation targets are released after capture.

Only the default three-quarter view rotates automatically. Hovering anywhere in its canvas pauses rotation; leaving the canvas resumes it. Other views stay still, and the UI has no rotation toggle. Camera transitions warm up the destination scene behind a decoded frame before revealing the camera's movement. Every view, including Hand, follows the same smooth orbit path with eased zoom and target movement.

Selecting the three-quarter view also resets a manually moved camera. Each view starts with fresh orbit controls after its camera transition, clearing the previous view's up-axis and mouse momentum so automatic rotation always uses the default upright axis and target. The catalog contains 33 band styles; Curve is excluded.

The first camera fit is applied before the ring becomes visible, so startup does not tween from a temporary position. Default rotation uses world Y as its up-axis and a single elapsed-time-based controls update per frame.

The default rotation speed is 1.5 (25% faster than the earlier 1.2 setting). Diamond environment sampling is rotated 15 degrees through each diamond material's rotation offset to reduce the central blue glare in face-on views.

Opening a gallery photo generates only that selected view at a higher resolution for zoom: up to 3072px on desktop and 2048px on mobile, based on the display size. Normal gallery generation stays at 1200px. Three detailed photos are cached per session, and closing the lightbox cancels unfinished detail generation.

**Inside-band engraving** offers Bottom, Right and Left positions with illustrated examples. Enable **Multiple positions** to select two or three areas; each selected area adds its own text field below the previous one. Enter up to 24 characters per position and press its **Engrave** button to apply. Draft text edits do not change the model or generate photographs. The camera centres the inscription in a medium close-up, with the floor shadow hidden in that view. A **Focus engraving** viewer control returns to it after orbiting or choosing another view. When several inscriptions are applied, position selectors in the live canvas and fourth photo switch independently. Changing the photo position renders only that image at 1200px and caches it. Disabling multiple positions keeps the currently focused selected position; removing the last inscription restores the side-profile photo. Reset design also clears all texts and positions.

Applied inscriptions follow the measured inner metal wall and carry through band, metal and head changes. All product photos use every applied inscription, and the fourth tile becomes an engraving view while any inscription is available. Photo capture and high-resolution zoom share that focus camera. The renderer caches surface measurements and independent text masks, checks for continuous metal around open stone seats, and updates only the metal shader and photos when text changes; it does not reload models or rebake diamonds. This is a recessed visual preview, not a manufacturing mesh cut. Inscription state stays in the current page and is not stored in MongoDB.

**View on hand** loads the hand only when selected and places its ring finger inside the current shank. `src/config/handPreview.json` stores the finger anchor, finger axis and measured cross-section radius for this particular hand model. The hand follows changes to the selected ring; the product photos continue to show the ring alone. This option is a 3D preview and does not request camera access or start AR.

Hand mode uses orbit controls aligned to the hand, supports right-drag panning, and zooms toward the cursor with a faster wheel response. Its right-hand fit is calibrated near the finger base with a crown alignment correction around the finger axis. A compact skin-tone control appears in its own right-side rail only in hand mode, with a selected-color swatch and continuous color gradient. Hand framing leaves clear space for both control rails while the canvas keeps the same size in every mode. The default is a warm fair tone with subdued skin reflections. Its gradient, handle and material use the sRGB palette in `src/config/skinTones.ts`; shader uniforms convert it to linear RGB while preserving skin detail and nail highlights. The selected color is a reference albedo, so studio lighting and display settings affect its rendered appearance.

To prepare the original hand file again, run `npm run hand:prepare -- "C:\\path\\female_hand.glb"`, then publish the assets with `npm run cloud:sync`. The original file is retained. See [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) for its recorded author, license and material conversion.

## Publishing data

Run `npm run models:clean` after adding shank GLBs exported from CAD. It removes construction lines, cutter objects and ring-size guides from the model files while preserving metal surfaces, diamonds and transforms. Originals are backed up under the ignored `artifacts/model-originals/` folder; the cleanup report is `artifacts/model-cleanup-report.json`.

Head and band thumbnails are pre-rendered locally at 360 × 280 into WebP images with polished silver reflections. CAD construction curves and cutters are excluded. The side panel lazy-loads those images without downloading or rendering each model. Development serves the local images; deployed builds load them from Cloudflare. After adding or changing a model, run the generator and open the localhost address it prints. Click **Generate thumbnails**. It saves images into `public/images/model-thumbnails/` and updates `src/config/modelThumbnails.json`; matching existing images are reused.

```sh
npm run thumbnails:generate
```

```sh
npm run cloud:check
npm run cloud:sync
```

These commands read MongoDB and Cloudflare credentials from `.env`. The sync command inventories `public/`, uploads assets to an immutable, project-specific R2 release, verifies public access and CORS, then publishes the MongoDB catalog. Rerunning the same release skips matching uploads. Existing bucket objects and unrelated database collections are retained.

The database collections are `ring_builder_catalogs` and `ring_builder_assets`. `src/config/deployment.json` contains the public asset base URL; it contains no credentials. Change catalog entries in `src/config/catalog.json`, regenerate any new model thumbnails, and rerun the sync before publishing changes.

The metal lighting environment is `public/metal_env.exr`, imported from `metal_custom_env_75.exr`. Replacing that file and running the cloud sync creates a new asset release so browsers load the updated reflections.

```sh
npm run check
npm run test:animation
npm run test:gallery
npm run test:engraving
npm run build
npm run test:deployment -- --live
npm run prepare:vercel
```

`prepare:vercel` creates a clean `vercel-upload/` folder for GitHub. Private environment files, installed dependencies, local assets and generated previews are excluded. The original project retains the local assets for future publishing.

Cloudflare write credentials stay in the local `.env`. Vercel needs the server-side MongoDB variables listed in the deployment guide. Keep all credential variables free of the `VITE_` prefix.
