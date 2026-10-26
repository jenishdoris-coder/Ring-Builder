import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run hand:prepare -- "C:\\path\\female_hand.glb"');
const source = await readFile(resolve(input));
if (source.toString("ascii", 0, 4) !== "glTF" || source.readUInt32LE(4) !== 2) throw new Error("Expected a GLB 2.0 hand model.");
const chunks = [];
for (let offset = 12; offset < source.length;) {
  const length = source.readUInt32LE(offset), type = source.readUInt32LE(offset + 4);
  chunks.push({ type, bytes: source.subarray(offset + 8, offset + 8 + length) }); offset += 8 + length;
}
const jsonChunk = chunks.find(chunk => chunk.type === 0x4e4f534a);
const gltf = JSON.parse(jsonChunk.bytes.toString("utf8"));
for (const material of gltf.materials ?? []) {
  const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!legacy) continue;
  material.pbrMetallicRoughness = { baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1], baseColorTexture: legacy.diffuseTexture, metallicFactor: 0, roughnessFactor: 0.68 };
  delete material.extensions.KHR_materials_pbrSpecularGlossiness;
  if (!Object.keys(material.extensions).length) delete material.extensions;
}
for (const key of ["extensionsUsed", "extensionsRequired"]) if (gltf[key]) {
  gltf[key] = gltf[key].filter(name => name !== "KHR_materials_pbrSpecularGlossiness");
  if (!gltf[key].length) delete gltf[key];
}
const json = Buffer.from(JSON.stringify(gltf));
jsonChunk.bytes = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(jsonChunk.bytes);
const output = Buffer.alloc(12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0));
output.write("glTF"); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
let offset = 12;
for (const chunk of chunks) { output.writeUInt32LE(chunk.bytes.length, offset); output.writeUInt32LE(chunk.type, offset + 4); chunk.bytes.copy(output, offset + 8); offset += 8 + chunk.bytes.length; }
const path = resolve("public/models/hand/female_hand.glb");
await mkdir(dirname(path), { recursive: true }); await writeFile(path, output);
console.log(JSON.stringify({ path, bytes: output.length, geometryChanged: false, texturesPreserved: true, attribution: gltf.asset.extras }));
