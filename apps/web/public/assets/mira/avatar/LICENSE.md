# Mira open-licensed anime avatar

`mira-anime-live-v2.vrm` is the VRM Consortium's
`VRM1_Constraint_Twist_Sample`, created by pixiv Inc. Its embedded VRM metadata
allows use by everyone, commercial use by corporations, modification and
redistribution. Credit is marked as unnecessary; this notice is retained for
clarity.

- Source: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample
- License: VRM Public License 1.0 — https://vrm.dev/licenses/1.0/
- Copyright: (c) 2022 pixiv Inc.
- SHA-256 of original VRM: `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`
- SHA-256 of shipped VRM: `3b5f011aa01902d8a64788af7713fe317fee3f7a38c0b6300003816f3374e69b`

The shipped file is losslessly repacked by `scripts/compact-avatar.mjs`:
identical buffer-view payloads share bytes, reducing 10,776,032 bytes to
9,001,324 bytes. All view indices, geometry, textures, morphs, rig, expression
bindings and embedded metadata/license remain unchanged. The original bytes
remain recoverable from repository history; the source link above is retained.

`mira-anime-live-v2.png` is the thumbnail embedded in that VRM and is used as
the graceful fallback while WebGL initializes or when 3D rendering is
unavailable.

The avatar is presented in the app as Mira. Companaro's motion, call layout,
voice synchronization and companion identity are original application work.

## Smaller web delivery derivative

`mira-anime-delivery-v1.glb.gz` is generated from the shipped source above by
`scripts/avatar-delivery.mjs`. Its 18 material textures are lossless WebP via
`EXT_texture_webp`: every decoded RGBA pixel is checked against the PNG source.
Geometry, nodes, skinning, morphs, expressions, material values and VRM metadata
are preserved. The unreferenced final thumbnail buffer is replaced by a URI to
the unchanged original PNG; its image index and the metadata reference survive.
No material uses that thumbnail. The resulting GLB is gzip-compressed for
transport, without a runtime decoder download or paid image service.

- Compressed delivery: 3,265,180 bytes.
- Gzip SHA-256: `cd33eb1a69390c571e8410c553c2f5c41b111142e9643a8c514ec82457d15960`.
- Decoded GLB: 4,946,016 bytes; SHA-256 `3defff1a0f5e5f3d453ab8f944a1e6ef0e021ccceecf15a15ef16bc4337053b4`.
- `mira-anime-portrait-v1.webp` is the same thumbnail encoded losslessly,
  542,802 bytes; SHA-256 `e6b32a6793d2c81c217e744025bf8040c1271792b01da53b76b1523da459f6cf`.

The original VRM/PNG remain available for compatibility and provenance.

## Call-ready profile (default)

`mira-anime-call-v2.glb.gz` and its raw `.glb` companion preserve every geometry
buffer, rig, expression binding, material value and VRM licence from the source.
Material textures use WebP quality 90, lossless alpha and at most 1024 pixels on
either edge. This profile is deliberately **not pixel-identical**: textures are
resized and RGB-compressed. Tests compare visible RGB against the resized
originals (mean absolute error below 5/255 per texture), exact alpha and all
geometry bytes. The larger lossless derivative is retained, not silently changed.

The default transfer is 1,235,862 bytes (raw GLB 2,920,764 bytes). Browsers without
native gzip decompression use the bounded, hash-verified raw call profile, never
the old 9 MB source. `mira-anime-preview-v2.webp` is a 384-pixel, 13,868-byte
thumbnail for immediate loading/error display. Exact hashes and dimensions are
recorded in `lib/avatar-call-manifest.json`; the generator validates both profiles.
