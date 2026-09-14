/** MMP1: bounded lossless transport, not a changed avatar/GLTF format.
 * Verify compressed bytes before decoding and reconstructed GLB afterwards.
 * Blocks fill consecutively: no offsets, overlap or external resources. */
export function decodeAvatarMesh(packed: Uint8Array, expected: number, decoder: {
  decodeVertexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
  decodeIndexSequence(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (expected < 28 || expected > 4_000_000 || packed.length < 12) throw new Error("Invalid avatar mesh budget");
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const blocks = view.getUint32(8, true);
  if (view.getUint32(0, true) !== 0x31504d4d || view.getUint32(4, true) !== expected || blocks < 1 || blocks > 2048) throw new Error("Invalid avatar mesh header");
  const output = new Uint8Array(expected);
  let cursor = 12, written = 0;
  for (let index = 0; index < blocks; index++) {
    signal?.throwIfAborted();
    if (cursor + 12 > packed.length) throw new Error("Incomplete avatar mesh block");
    const length = view.getUint32(cursor, true), size = view.getUint32(cursor + 4, true), stride = view.getUint32(cursor + 8, true);
    cursor += 12;
    if (!length || !size || written + length > expected || cursor + size > packed.length
      || (stride === 0 ? size !== length : stride > 256 || (stride % 4 !== 0 && stride !== 2) || length % stride !== 0)) throw new Error("Invalid avatar mesh block");
    const source = packed.subarray(cursor, cursor + size), target = output.subarray(written, written + length);
    if (stride === 2) decoder.decodeIndexSequence(target, length / stride, stride, source);
    else if (stride) decoder.decodeVertexBuffer(target, length / stride, stride, source);
    else target.set(source);
    cursor += size; written += length;
  }
  if (cursor !== packed.length || written !== expected) throw new Error("Incomplete avatar mesh delivery");
  signal?.throwIfAborted();
  return output;
}
