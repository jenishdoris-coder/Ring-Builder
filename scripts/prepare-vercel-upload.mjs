import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const workspace = resolve(".");
const output = resolve("vercel-upload");
const marker = ".ring-builder-package.json";
if (output !== join(workspace, "vercel-upload")) throw new Error("Invalid upload folder.");
try {
  const existing = await lstat(output);
  if (!existing.isDirectory() || existing.isSymbolicLink() || JSON.parse(await readFile(join(output, marker), "utf8")).generator !== "ring-builder") throw new Error("Refusing to replace an unrelated upload folder.");
  // The absolute target and ownership marker above are checked before deletion.
  await rm(output, { recursive: true, force: true });
} catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(output, { recursive: true });

const roots = ["src", "api", "scripts"];
const topFiles = ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "vercel.json", "index.html", ".gitignore", ".vercelignore", ".env.example", "README.md", "DEPLOY_VERCEL.md", "THIRD_PARTY_ASSETS.md"];
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the upload: ${path}`);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && (directory !== "scripts" || entry.name.endsWith(".mjs"))) files.push(path);
  }
}
for (const directory of roots) await collect(directory);
files.push(...topFiles);
for (const path of files) {
  const name = relative(workspace, resolve(path));
  if (/^\.env(?:\.|$)/.test(name) && name !== ".env.example") throw new Error("Private environment files cannot be packaged.");
  const destination = join(output, name);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await copyFile(path, destination);
}
await writeFile(join(output, marker), JSON.stringify({ generator: "ring-builder", createdAt: new Date().toISOString() }, null, 2));
if (files.length + 1 > 100) throw new Error("Upload exceeds GitHub's 100-file browser upload limit.");
console.log(JSON.stringify({ folder: output, files: files.length + 1, credentialsIncluded: false, localModelsIncluded: false }));
