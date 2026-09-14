import assert from "node:assert/strict";

/** A call-only derivative: retain 14 fraction bits for render attributes.
 * Never touch joints, skin weights, transforms, indices or VRM metadata.
 * Per-component errors are measured, bounded and recorded before publishing.
 * The original and v2 assets remain available unchanged. */
export function boundCallPrecision(glb, model, binaryOffset) {
  const done = new Set(), errors = {};
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
    for (const attributes of [primitive.attributes, ...(primitive.targets ?? [])]) for (const [kind, id] of Object.entries(attributes)) {
      if (!/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+)$/.test(kind)) continue;
      const accessor = model.accessors[id];
      if (accessor.componentType !== 5126) continue;
      const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
      assert.ok(components);
      for (const [viewId, count, offset] of [[accessor.bufferView, accessor.count, accessor.byteOffset ?? 0],
        [accessor.sparse?.values?.bufferView, accessor.sparse?.count, accessor.sparse?.values?.byteOffset ?? 0]]) {
        if (viewId === undefined) continue;
        const view = model.bufferViews[viewId], stride = view.byteStride ?? components * 4;
        for (let index = 0; index < count; index++) for (let component = 0; component < components; component++) {
          const position = binaryOffset + view.byteOffset + offset + index * stride + component * 4;
          if (done.has(position)) continue;
          done.add(position);
          const originalBits = glb.readUInt32LE(position), original = glb.readFloatLE(position);
          glb.writeUInt32LE((originalBits & 0xfffffe00) >>> 0, position);
          const next = glb.readFloatLE(position), error = Math.abs(original - next);
          assert.ok(Number.isFinite(next) && error < 0.000062, `Call attribute error budget: ${kind}`);
          // Preserve conservative accessor bounds, including tiny negative
          // differences at extrema; never move a vertex outside its old bounds.
          if ((accessor.min && next < accessor.min[component]) || (accessor.max && next > accessor.max[component])) {
            glb.writeUInt32LE(originalBits, position); continue;
          }
          errors[kind] = Math.max(errors[kind] ?? 0, error);
        }
      }
    }
  }
  return { fractionBits: 14, maxComponentError: errors, unchanged: ["indices", "joints", "weights", "rig", "expressionBindings", "textures"] };
}
