"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type AvatarMouthPose = 0 | 1 | 2 | 3;

const assetRoot = "/assets/mira/rocketbox";

// Female_Adult_08_facial ships its first 52 morph targets in Apple ARKit order.
const face = {
  blinkLeft: 8,
  blinkRight: 9,
  jawOpen: 24,
  mouthClose: 26,
  mouthFunnel: 31,
  mouthLowerDownLeft: 33,
  mouthLowerDownRight: 34,
  mouthPucker: 37,
  mouthSmileLeft: 43,
  mouthSmileRight: 44,
  mouthStretchLeft: 45,
  mouthStretchRight: 46,
} as const;

type MorphMesh = THREE.SkinnedMesh & { morphTargetInfluences: number[] };

function isMorphMesh(object: THREE.Object3D): object is MorphMesh {
  return object instanceof THREE.SkinnedMesh && Boolean(object.morphTargetInfluences?.length);
}

function targetForPose(pose: AvatarMouthPose) {
  if (pose === 1) return { jaw: 0.26, funnel: 0.05, pucker: 0.02, stretch: 0.08 };
  if (pose === 2) return { jaw: 0.54, funnel: 0.04, pucker: 0, stretch: 0.14 };
  if (pose === 3) return { jaw: 0.32, funnel: 0.34, pucker: 0.3, stretch: 0 };
  return { jaw: 0, funnel: 0, pucker: 0, stretch: 0 };
}

function setMorph(mesh: MorphMesh, index: number, target: number, smoothing = 0.24) {
  const current = mesh.morphTargetInfluences[index] ?? 0;
  mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(current, target, smoothing);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export function LiveAvatar3D({
  companionName,
  speaking,
  thinking,
  listening,
  blinking,
  mouthPose,
}: {
  companionName: string;
  speaking: boolean;
  thinking: boolean;
  listening: boolean;
  blinking: boolean;
  mouthPose: AvatarMouthPose;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ speaking, thinking, listening, blinking, mouthPose });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    stateRef.current = { speaking, thinking, listening, blinking, mouthPose };
  }, [blinking, listening, mouthPose, speaking, thinking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let frame = 0;
    let avatar: THREE.Group | null = null;
    const morphMeshes: MorphMesh[] = [];
    let head: THREE.Object3D | null = null;
    let neck: THREE.Object3D | null = null;
    let spine: THREE.Object3D | null = null;
    let leftEye: THREE.Object3D | null = null;
    let rightEye: THREE.Object3D | null = null;
    let pointerX = 0;
    let pointerY = 0;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch (cause) {
      console.warn("3D avatar renderer unavailable", cause);
      setLoadState("fallback");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.05, 20);
    camera.position.set(0.02, 1.55, 0.9);
    camera.lookAt(0, 1.55, 0);

    const hemisphere = new THREE.HemisphereLight(0xffeee6, 0x251c2d, 2.15);
    const key = new THREE.DirectionalLight(0xffdfce, 3.4);
    key.position.set(-1.6, 2.8, 2.4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 2.5);
    rim.position.set(1.8, 2.1, -1.8);
    const fill = new THREE.PointLight(0xff8b75, 1.6, 4);
    fill.position.set(1.2, 1.25, 1.3);
    scene.add(hemisphere, key, rim, fill);

    const textureLoader = new THREE.TextureLoader();
    const loadTexture = async (name: string, color = false) => {
      const texture = await textureLoader.loadAsync(`${assetRoot}/${name}`);
      texture.flipY = false;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    Promise.all([
      loader.loadAsync(`${assetRoot}/mira-avatar.glb`),
      loadTexture("body-color.jpg", true),
      loadTexture("body-normal.jpg"),
      loadTexture("head-color.jpg", true),
      loadTexture("head-normal.jpg"),
      loadTexture("hair-alpha.png", true),
    ]).then(([gltf, bodyColor, bodyNormal, headColor, headNormal, hairAlpha]) => {
      if (!active) {
        disposeObject(gltf.scene);
        for (const texture of [bodyColor, bodyNormal, headColor, headNormal, hairAlpha]) texture.dispose();
        return;
      }

      avatar = gltf.scene;
      avatar.name = "MiraOpenSourceAvatar";
      avatar.rotation.y = 0;
      avatar.position.set(0, 0, 0);

      avatar.traverse((object) => {
        if (!isMorphMesh(object)) return;
        morphMeshes.push(object);
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          material.roughness = 0.76;
          material.metalness = 0;
          material.envMapIntensity = 0.35;
          if (material.name === "f008_body") {
            material.map = bodyColor;
            material.normalMap = bodyNormal;
            material.normalScale.set(0.55, 0.55);
          } else if (material.name === "f008_head") {
            material.map = headColor;
            material.normalMap = headNormal;
            material.normalScale.set(0.46, 0.46);
          } else if (material.name === "f008_opacity") {
            material.map = hairAlpha;
            material.alphaMap = hairAlpha;
            material.transparent = true;
            material.alphaTest = 0.34;
            material.side = THREE.DoubleSide;
            material.depthWrite = true;
          }
          material.needsUpdate = true;
        }
      });

      head = avatar.getObjectByName("Bip01 Head") ?? null;
      neck = avatar.getObjectByName("Bip01 Neck") ?? null;
      spine = avatar.getObjectByName("Bip01 Spine2") ?? null;
      leftEye = avatar.getObjectByName("Bip01 LEye") ?? null;
      rightEye = avatar.getObjectByName("Bip01 REye") ?? null;
      scene.add(avatar);
      setLoadState("ready");
    }).catch((cause) => {
      console.warn("3D avatar assets failed to load", cause);
      if (active) setLoadState("fallback");
    });

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const compact = width < 720;
      camera.fov = compact ? 30 : 27;
      camera.position.set(compact ? 0 : 0.02, compact ? 1.54 : 1.55, compact ? 1.04 : 0.9);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
      pointerY = THREE.MathUtils.clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1);
    };
    const onPointerLeave = () => { pointerX = 0; pointerY = 0; };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    const startedAt = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const elapsed = (performance.now() - startedAt) / 1_000;
      const state = stateRef.current;
      const pose = targetForPose(state.mouthPose);
      const naturalSmile = 0;
      const blink = state.blinking ? 1 : 0;

      for (const mesh of morphMeshes) {
        setMorph(mesh, face.blinkLeft, blink, state.blinking ? 0.72 : 0.33);
        setMorph(mesh, face.blinkRight, blink, state.blinking ? 0.72 : 0.33);
        setMorph(mesh, face.jawOpen, pose.jaw, 0.34);
        setMorph(mesh, face.mouthClose, state.mouthPose === 0 ? 0.04 : 0, 0.3);
        setMorph(mesh, face.mouthFunnel, pose.funnel, 0.3);
        setMorph(mesh, face.mouthPucker, pose.pucker, 0.3);
        setMorph(mesh, face.mouthStretchLeft, pose.stretch, 0.3);
        setMorph(mesh, face.mouthStretchRight, pose.stretch, 0.3);
        setMorph(mesh, face.mouthLowerDownLeft, pose.jaw * 0.18, 0.3);
        setMorph(mesh, face.mouthLowerDownRight, pose.jaw * 0.18, 0.3);
        setMorph(mesh, face.mouthSmileLeft, naturalSmile, 0.12);
        setMorph(mesh, face.mouthSmileRight, naturalSmile, 0.12);
      }

      const speechEnergy = reducedMotion ? 0 : state.speaking ? 1 : 0.45;
      if (spine) {
        spine.rotation.x = Math.sin(elapsed * 1.35) * 0.007 * speechEnergy;
        spine.rotation.z = Math.sin(elapsed * 0.62) * 0.006;
      }
      if (neck) {
        neck.rotation.y = THREE.MathUtils.lerp(neck.rotation.y, pointerX * -0.055 + Math.sin(elapsed * 0.35) * 0.018, 0.035);
        neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, pointerY * 0.035 + Math.sin(elapsed * 0.57) * 0.008, 0.035);
      }
      if (head) {
        const conversationalNod = state.speaking ? Math.sin(elapsed * 2.15) * 0.014 : Math.sin(elapsed * 0.51) * 0.007;
        head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, conversationalNod, 0.04);
        head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, Math.sin(elapsed * 0.29) * 0.01, 0.035);
      }
      if (leftEye && rightEye) {
        leftEye.rotation.y = THREE.MathUtils.lerp(leftEye.rotation.y, pointerX * -0.06, 0.08);
        rightEye.rotation.y = THREE.MathUtils.lerp(rightEye.rotation.y, pointerX * -0.06, 0.08);
        leftEye.rotation.x = THREE.MathUtils.lerp(leftEye.rotation.x, pointerY * 0.04, 0.08);
        rightEye.rotation.x = THREE.MathUtils.lerp(rightEye.rotation.x, pointerY * 0.04, 0.08);
      }
      if (avatar) avatar.position.y = Math.sin(elapsed * 1.28) * 0.0025;

      camera.lookAt(pointerX * -0.018, 1.55 + pointerY * -0.012, 0);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      if (avatar) disposeObject(avatar);
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`live-avatar-3d live-avatar-3d--${loadState}`}>
      <img className="live-avatar-3d__fallback" src="/assets/mira/video-call-real-idle.jpg" alt="" draggable={false} />
      <canvas ref={canvasRef} className="live-avatar-3d__canvas" role="img" aria-label={`${companionName}, an animated open-source 3D companion`} />
      {loadState === "loading" ? <span className="live-avatar-3d__loading">Bringing {companionName} into the call…</span> : null}
      {loadState === "fallback" ? <span className="live-avatar-3d__loading">3D is unavailable on this device · using portrait mode</span> : null}
    </div>
  );
}
