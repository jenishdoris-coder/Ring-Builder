import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

const root = resolve("public");
const source = JSON.parse(await readFile("src/config/catalog.json", "utf8"));
const helperName = /channel.?cutter|ring.?rail|micro.?pave.?cut/i;
const helperMaterial = /creation.?curves|finger.?sizes/i;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const changes = [];

for (const shank of source.shanks) {
  const path = resolve(root, `.${shank.file}`);
  if (!path.startsWith(root + sep)) throw new Error("Model is outside the public asset folder.");
  const original = await readFile(path);
  if (original.toString("ascii", 0, 4) !== "glTF" || original.readUInt32LE(4) !== 2 || original.readUInt32LE(8) !== original.length) throw new Error(`Invalid GLB: ${shank.file}`);
  const chunks = [];
  for (let offset = 12; offset < original.length;) {
    const length = original.readUInt32LE(offset), type = original.readUInt32LE(offset + 4);
    if (offset + 8 + length > original.length) throw new Error(`Invalid GLB chunk: ${shank.file}`);
    chunks.push({ type, bytes: original.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  const jsonChunk = chunks.find(chunk => chunk.type === 0x4e4f534a);
  if (!jsonChunk) throw new Error(`Missing GLB JSON: ${shank.file}`);
  const gltf = JSON.parse(jsonChunk.bytes.toString("utf8"));
  const helperNodes = new Set();
  function markHelper(index) {
    if (helperNodes.has(index)) return;
    helperNodes.add(index);
    for (const child of gltf.nodes[index].children ?? []) markHelper(child);
  }
  for (const [index, node] of (gltf.nodes ?? []).entries()) if (helperName.test(node.name ?? "")) markHelper(index);
  let removedObjects = 0, removedPrimitives = 0;
  for (const index of helperNodes) {
    if (gltf.nodes[index].mesh !== undefined) { delete gltf.nodes[index].mesh; removedObjects++; }
  }
  const meshes = [], remap = new Map();
  for (const [index, mesh] of (gltf.meshes ?? []).entries()) {
    const primitives = mesh.primitives.filter(primitive => {
      const materialName = gltf.materials?.[primitive.material]?.name ?? "";
      const keep = (primitive.mode ?? 4) >= 4 && !helperMaterial.test(materialName);
      if (!keep) removedPrimitives++;
      return keep;
    });
    if (primitives.length) { remap.set(index, meshes.length); meshes.push({ ...mesh, primitives }); }
  }
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue;
    if (remap.has(node.mesh)) node.mesh = remap.get(node.mesh);
    else { delete node.mesh; removedObjects++; }
  }
  if (!removedObjects && !removedPrimitives) continue;
  if (!(gltf.nodes ?? []).some(node => node.mesh !== undefined)) throw new Error(`Cleanup would remove all surfaces: ${shank.file}`);
  gltf.meshes = meshes;
  // Node, accessor, material and binary buffer indices are preserved. Only helper
  // geometry is detached; genuine metal surfaces and diamond instances remain.
  const json = Buffer.from(JSON.stringify(gltf));
  jsonChunk.bytes = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(jsonChunk.bytes);
  const length = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
  const cleaned = Buffer.alloc(length);
  cleaned.write("glTF", 0); cleaned.writeUInt32LE(2, 4); cleaned.writeUInt32LE(length, 8);
  let offset = 12;
  for (const chunk of chunks) {
    cleaned.writeUInt32LE(chunk.bytes.length, offset); cleaned.writeUInt32LE(chunk.type, offset + 4);
    chunk.bytes.copy(cleaned, offset + 8); offset += 8 + chunk.bytes.length;
  }
  const backup = resolve("artifacts/model-originals", hash(original).slice(0, 20), basename(path));
  await mkdir(dirname(backup), { recursive: true });
  try { await writeFile(backup, original, { flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  await writeFile(`${path}.cleaning`, cleaned);
  await rename(`${path}.cleaning`, path);
  const change = { id: shank.id, name: shank.name, file: shank.file, removedObjects, removedPrimitives, originalSha256: hash(original), cleanedSha256: hash(cleaned), backup };
  changes.push(change);
  console.log(JSON.stringify({ stage: "cleaned", name: shank.name, removedObjects, removedPrimitives }));
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/model-cleanup-report.json", JSON.stringify({ completedAt: new Date().toISOString(), inspected: source.shanks.length, cleaned: changes.length, changes }, null, 2) + "\n");
console.log(JSON.stringify({ stage: "complete", inspected: source.shanks.length, cleaned: changes.length, stylesRemoved: 0, originalBackups: "artifacts/model-originals" }));
