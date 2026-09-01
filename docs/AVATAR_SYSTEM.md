# Luma avatar system

## Goal

The avatar is a renderer-independent character layer. The shipping mock uses authored raster scenes; the runtime contract supports GLTF/VRM, Live2D, or a remote video avatar without changing product screens.

## Runtime interfaces

`AvatarRenderer` loads the character and environment progressively. `ExpressionEngine` maps semantic emotion to facial state. `GestureEngine` selects non-repeating body motion. `LipSyncEngine` consumes visemes when available and audio amplitude otherwise. `EnvironmentRenderer` controls time, ambience, and camera. `AvatarBehaviorEngine` coordinates them.

## State model

```text
idle → notice-user → listening → thinking → speaking → reacting → idle
```

Expressions include neutral, happy, excited, laughing, shy, playful, curious, concerned, thoughtful, surprised, sleepy, romantic, flirty, blushing, and teasing. Gestures include wave, nod, head shake, laugh, shrug, look away, lean, chin touch, small clap, bounce, hair adjustment, kiss, heart, hug, dance, stretch, and breathing.

The behavior engine applies cooldowns and weighted history so the same animation is not repeated. Gaze varies by state: mostly camera-facing while listening, brief side glances while thinking, downward glance while shy, and stronger eye contact while excited.

## Progressive loading

The interface shell appears first, followed by a low-resolution environment, avatar silhouette/preview, model, animations, and high-resolution textures. A failed renderer falls back to the authored scene while chat and calls remain usable.

## Asset policy

Only original or commercially licensed characters, environments, outfits, and animations may ship. Current generated artwork is prototype material pending provenance approval.
