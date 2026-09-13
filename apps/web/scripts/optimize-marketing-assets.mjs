import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

// Build-time format conversion only. Retain the original artwork for other
// views; no runtime image service, third-party request or paid transform.
const root = resolve(import.meta.dirname, "../public/assets/mira");
const assets = [
  { source: "loft-morning.png", output: "loft-morning-delivery.webp", width: 1536, height: 1024, budget: 260_000 },
  { source: "portrait.png", output: "portrait-delivery.webp", width: 768, height: 768, budget: 100_000 },
];
const check = process.argv.includes("--check");
for (const asset of assets) {
  const source = resolve(root, asset.source), output = resolve(root, asset.output);
  assert.notEqual(source, output, "Never overwrite source artwork");
  if (!check) await sharp(source).resize({ width: asset.width, height: asset.height, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toFile(output);
  const data = await readFile(output), metadata = await sharp(data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, asset.width);
  assert.equal(metadata.height, asset.height);
  assert.ok(data.length <= asset.budget, `${asset.output} exceeds its measured transfer budget`);
  assert.equal(metadata.exif, undefined, "Public derivatives must not contain EXIF metadata");
  console.log(JSON.stringify({ asset: asset.output, width: metadata.width, height: metadata.height, originalBytes: (await stat(source)).size, bytes: data.length, budgetBytes: asset.budget, checkOnly: check }));
}
