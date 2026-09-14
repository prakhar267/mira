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
