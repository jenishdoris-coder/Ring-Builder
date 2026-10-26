import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(root, "public");
const catalog = JSON.parse(await readFile(resolve(root, "src/config/catalog.json"), "utf8"));
const rendererSource = await readFile(resolve(root, "scripts/thumbnail-renderer.mjs"));
const meshSource = await readFile(resolve(root, "src/utils/meshUtils.ts"));
const definitions = [...catalog.shapes.flatMap(shape => shape.carats.map(carat => ({ file: carat.file, kind: "head" }))), ...catalog.shanks.map(shank => ({ file: shank.file, kind: "shank" }))];
const tasks = [];
const images = {};
let reused = 0;
for (const item of definitions) {
  const sourcePath = resolve(publicRoot, `.${item.file}`);
  if (!sourcePath.startsWith(publicRoot + sep)) throw new Error("Model path is outside public assets.");
  const digest = createHash("sha256").update(rendererSource).update(meshSource).update(item.kind).update(await readFile(sourcePath)).digest("hex").slice(0, 20);
  const imagePath = `/images/model-thumbnails/${item.kind}-${digest}.webp`;
  const output = resolve(publicRoot, `.${imagePath}`);
  images[`${item.kind}:${item.file}`] = imagePath;
  try { if ((await stat(output)).size > 0) { reused++; continue; } } catch (error) { if (error.code !== "ENOENT") throw error; }
  tasks.push({ ...item, index: tasks.length, imagePath, output });
}
async function finish() {
  for (const image of Object.values(images)) if (!(await stat(resolve(publicRoot, `.${image}`))).size) throw new Error("A generated thumbnail is missing.");
  await writeFile(resolve(root, "src/config/modelThumbnails.json"), JSON.stringify({ width: 360, height: 280, images }, null, 2) + "\n");
  console.log(JSON.stringify({ stage: "complete", generated: tasks.length, reused, total: definitions.length, width: 360, height: 280 }));
}
if (!tasks.length) { await finish(); process.exit(0); }

const token = randomBytes(24).toString("hex");
const origin = "http://127.0.0.1:5174";
let completed = 0;
const saved = new Set();
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Generate ring thumbnails</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;color:#20252b}button{padding:12px 24px}#previews{display:flex;flex-wrap:wrap}img{width:120px;height:94px;object-fit:contain}</style></head><body><h1>Generate static ring thumbnails</h1><p>Creates 360 × 280 WebP images locally. Existing matching images are reused.</p><button id="generate">Generate thumbnails</button><p id="status">Ready: ${tasks.length} images to generate; ${reused} already saved.</p><div id="previews"></div><script type="module">
import { renderThumbnail } from '/scripts/thumbnail-renderer.mjs';
const button=document.querySelector('#generate'), status=document.querySelector('#status');
button.addEventListener('click',async()=>{
  button.disabled=true;
  try {
    const tasks=await (await fetch('/__thumbnail_tasks')).json();
    for(const task of tasks){
      status.textContent='Generating '+(task.index+1)+' / '+tasks.length+': '+task.file.split('/').pop();
      const blob=await renderThumbnail(task.file.split('/').map(encodeURIComponent).join('/'),task.kind);
      const response=await fetch('/__thumbnail_save/'+task.index,{method:'PUT',headers:{'X-Thumbnail-Token':${JSON.stringify(token)},'Content-Type':'image/webp'},body:blob});
      if(!response.ok)throw new Error(await response.text());
      const image=new Image();image.src=URL.createObjectURL(blob);image.alt=task.file.split('/').pop();document.querySelector('#previews').append(image);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const response=await fetch('/__thumbnail_finish',{method:'POST',headers:{'X-Thumbnail-Token':${JSON.stringify(token)}}});
    if(!response.ok)throw new Error(await response.text());
    status.textContent='Complete: '+tasks.length+' thumbnails generated and saved locally.';
  }catch(error){status.textContent='Generation failed: '+error.message;button.disabled=false;}
});</script></body></html>`;

const server = await createServer({
  root, configFile: false, publicDir: "public", appType: "custom",
  server: { host: "127.0.0.1", port: 5174, strictPort: true, watch: { usePolling: true, interval: 300, ignored: ["**/public/images/model-thumbnails/**", "**/artifacts/**", "**/vercel-upload/**"] } },
  plugins: [{ name: "local-thumbnail-writer", configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const path = request.url?.split("?")[0];
      if (!path?.startsWith("/__thumbnail_") && path !== "/") return next();
      try {
        if (path === "/" && request.method === "GET") { response.setHeader("Content-Type", "text/html"); response.end(await vite.transformIndexHtml("/", html)); return; }
        if (path === "/__thumbnail_tasks" && request.method === "GET") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(tasks.map(({ output, ...task }) => task))); return; }
        if (request.headers.origin !== origin || request.headers["x-thumbnail-token"] !== token) { response.writeHead(403); response.end("Local generation token required."); return; }
        if (path?.startsWith("/__thumbnail_save/") && request.method === "PUT") {
          const task = tasks[Number(path.slice("/__thumbnail_save/".length))];
          if (!task) throw new Error("Unknown thumbnail.");
          const chunks = []; let length = 0;
          for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024) throw new Error("Thumbnail too large."); chunks.push(chunk); }
          const bytes = Buffer.concat(chunks);
          if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error("Expected WebP image.");
          await mkdir(dirname(task.output), { recursive: true });
          await writeFile(task.output, bytes);
          if (!saved.has(task.index)) { saved.add(task.index); completed++; }
          if (completed % 20 === 0 || completed === tasks.length) console.log(JSON.stringify({ stage: "generating", completed, total: tasks.length }));
          response.end("Saved"); return;
        }
        if (path === "/__thumbnail_finish" && request.method === "POST") {
          if (saved.size !== tasks.length) throw new Error("Generation is incomplete.");
          await finish(); response.end("Complete");
          setTimeout(() => { server.close().then(() => process.exit(0)); }, 1000); return;
        }
        response.writeHead(404); response.end();
      } catch (error) { response.writeHead(500); response.end(error.message); console.error(error.message); }
    });
  } }],
});
await server.listen();
console.log(`Open ${origin} and click Generate thumbnails. All rendering and file output stay on this computer.`);
