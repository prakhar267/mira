import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const align = n => Math.ceil(n / 4) * 4;

/** Keep every VRM expression and nonzero default weight, pruning only unbound
 * zero-weight morphs. No simplification/quantization of surviving geometry.
 * This is a separate call derivative; archival profiles are not overwritten. */
export function pruneCallMorphs(input) {
  assert.equal(input.readUInt32LE(0), 0x46546c67);
  assert.equal(input.readUInt32LE(4), 2);
  assert.equal(input.readUInt32LE(8), input.length);
  const n = input.readUInt32LE(12), model = JSON.parse(input.subarray(20, 20 + n));
  assert.equal(input.readUInt32LE(16), 0x4e4f534a);
  assert.equal(input.readUInt32LE(24 + n), 0x004e4942);
  const binary = input.subarray(28 + n);
  assert.equal(model.buffers.length, 1);
  assert.ok(!model.animations?.length, "Animation weight channels need separate remapping");
  const known = new Set(["VRMC_springBone", "VRMC_vrm", "KHR_materials_unlit", "VRMC_materials_mtoon", "VRMC_node_constraint", "EXT_texture_webp"]);
  assert.ok(model.extensionsUsed.every(name => known.has(name)), "Review new reference-bearing extensions first");
  const expressions = Object.values(model.extensions.VRMC_vrm.expressions).flatMap(group => Object.values(group));
  const keep = model.meshes.map(mesh => new Set(mesh.weights?.flatMap((weight, i) => weight ? [i] : []) ?? []));
  for (const node of model.nodes) if (node.mesh !== undefined) node.weights?.forEach((weight, i) => { if (weight) keep[node.mesh].add(i); });
  for (const expression of expressions) for (const bind of expression.morphTargetBinds ?? []) {
    const mesh = model.nodes[bind.node]?.mesh;
    assert.ok(mesh !== undefined && Number.isSafeInteger(bind.index));
    keep[mesh].add(bind.index);
  }
  const mappings = [], retained = [];
  for (const [meshId, mesh] of model.meshes.entries()) {
    const count = mesh.primitives[0].targets?.length ?? 0;
    assert.ok(mesh.primitives.every(p => (p.targets?.length ?? 0) === count));
    const indices = [...keep[meshId]].sort((a, b) => a - b);
    assert.ok(indices.every(i => i >= 0 && i < count));
    const mapping = new Map(indices.map((old, index) => [old, index])); mappings.push(mapping);
    if (count) retained.push({ mesh: meshId, original: count, retained: indices });
    for (const p of mesh.primitives) if (p.targets) {
      p.targets = indices.map(i => p.targets[i]); if (!p.targets.length) delete p.targets;
    }
    if (mesh.weights) mesh.weights = indices.map(i => mesh.weights[i]);
    if (mesh.extras?.targetNames) mesh.extras.targetNames = indices.map(i => mesh.extras.targetNames[i]);
    for (const node of model.nodes) if (node.mesh === meshId && node.weights) node.weights = indices.map(i => node.weights[i]);
  }
  for (const expression of expressions) for (const bind of expression.morphTargetBinds ?? []) bind.index = mappings[model.nodes[bind.node].mesh].get(bind.index);

  // Remap the complete set of accessor references supported by this VRM.
  const refs = [];
  const add = (object, key) => { if (object[key] !== undefined) refs.push([object, key]); };
  for (const mesh of model.meshes) for (const p of mesh.primitives) {
    add(p, "indices");
    for (const attrs of [p.attributes, ...(p.targets ?? [])]) for (const key of Object.keys(attrs)) add(attrs, key);
  }
  for (const skin of model.skins) add(skin, "inverseBindMatrices");
  const accessorIds = [...new Set(refs.map(([object, key]) => object[key]))].sort((a, b) => a - b);
  const accessorMap = new Map(accessorIds.map((old, index) => [old, index]));
  model.accessors = accessorIds.map(i => model.accessors[i]);
  for (const [object, key] of refs) object[key] = accessorMap.get(object[key]);
  const views = [];
  for (const a of model.accessors) {
    assert.ok(!a.extensions);
    if (a.bufferView !== undefined) views.push([a, "bufferView"]);
    if (a.sparse) views.push([a.sparse.indices, "bufferView"], [a.sparse.values, "bufferView"]);
  }
  for (const image of model.images) if (image.bufferView !== undefined) views.push([image, "bufferView"]);
  const viewIds = [...new Set(views.map(([object, key]) => object[key]))].sort((a, b) => a - b);
  const viewMap = new Map(viewIds.map((old, index) => [old, index]));
  model.bufferViews = viewIds.map(i => model.bufferViews[i]);
  for (const [object, key] of views) object[key] = viewMap.get(object[key]);
  const payloads = [], unique = new Map(); let length = 0;
  for (const view of model.bufferViews) {
    assert.ok(view.buffer === 0 && !view.extensions && view.byteOffset >= 0 && view.byteOffset + view.byteLength <= binary.length);
    const bytes = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!unique.has(hash)) { unique.set(hash, length); const padded = Buffer.alloc(align(bytes.length)); bytes.copy(padded); payloads.push(padded); length += padded.length; }
    view.byteOffset = unique.get(hash);
  }
  model.buffers[0].byteLength = length;
  const json = Buffer.from(JSON.stringify(model)), jsonLength = align(json.length), glb = Buffer.alloc(28 + jsonLength + length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonLength, 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.fill(32, 20, 20 + jsonLength); json.copy(glb, 20);
  glb.writeUInt32LE(length, 20 + jsonLength); glb.writeUInt32LE(0x004e4942, 24 + jsonLength); Buffer.concat(payloads).copy(glb, 28 + jsonLength);
  return { glb, retained };
}
