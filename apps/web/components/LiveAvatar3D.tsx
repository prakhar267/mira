"use client";

import { useEffect, useRef, useState } from "react";
import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type AvatarMouthPose = 0 | 1 | 2 | 3;
export type AvatarEmotion = "natural" | "happy" | "playful" | "tender" | "intimate" | "sad" | "angry";

const avatarAsset = "/assets/mira/avatar/mira-anime-live-v2.vrm";

function targetForPose(pose: AvatarMouthPose) {
  if (pose === 1) return { aa: 0, ee: .08, ih: .44, oh: 0, ou: 0 };
  if (pose === 2) return { aa: .58, ee: .05, ih: 0, oh: .05, ou: 0 };
  if (pose === 3) return { aa: .04, ee: 0, ih: 0, oh: .2, ou: .52 };
  return { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
}

function emotionTargets(emotion: AvatarEmotion) {
  if (emotion === "happy") return { happy: .34, relaxed: .08, sad: 0, angry: 0, surprised: 0 };
  if (emotion === "playful") return { happy: .24, relaxed: .12, sad: 0, angry: 0, surprised: .035 };
  if (emotion === "tender") return { happy: .08, relaxed: .28, sad: 0, angry: 0, surprised: 0 };
  if (emotion === "intimate") return { happy: .1, relaxed: .34, sad: 0, angry: 0, surprised: 0 };
  if (emotion === "sad") return { happy: 0, relaxed: .04, sad: .38, angry: 0, surprised: 0 };
  if (emotion === "angry") return { happy: 0, relaxed: 0, sad: .03, angry: .43, surprised: 0 };
  return { happy: .055, relaxed: .14, sad: 0, angry: 0, surprised: 0 };
}

function setExpression(vrm: VRM, name: string, target: number, smoothing = .2) {
  const current = vrm.expressionManager?.getValue(name) ?? 0;
  vrm.expressionManager?.setValue(name, THREE.MathUtils.lerp(current, target, smoothing));
}

function prepareAvatar(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.frustumCulled = false;
    object.castShadow = false;
    object.receiveShadow = false;
  });
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
  emotion = "natural",
}: {
  companionName: string;
  speaking: boolean;
  thinking: boolean;
  listening: boolean;
  blinking: boolean;
  mouthPose: AvatarMouthPose;
  emotion?: AvatarEmotion;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ speaking, thinking, listening, blinking, mouthPose, emotion });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    stateRef.current = { speaking, thinking, listening, blinking, mouthPose, emotion };
  }, [blinking, emotion, listening, mouthPose, speaking, thinking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let frame = 0;
    let avatar: THREE.Group | null = null;
    let vrm: VRM | null = null;
    let head: THREE.Object3D | null = null;
    let neck: THREE.Object3D | null = null;
    let spine: THREE.Object3D | null = null;
    let leftEye: THREE.Object3D | null = null;
    let rightEye: THREE.Object3D | null = null;
    let headBase: THREE.Euler | null = null;
    let neckBase: THREE.Euler | null = null;
    let spineBase: THREE.Euler | null = null;
    let leftEyeBase: THREE.Euler | null = null;
    let rightEyeBase: THREE.Euler | null = null;
    let spineBaseY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let modelLoaded = false;
    let stableFrames = 0;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch (cause) {
      console.warn("3D avatar renderer unavailable", cause);
      setLoadState("fallback");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.45));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, .05, 20);
    camera.position.set(0, 1.53, 1.04);
    camera.lookAt(0, 1.53, 0);

    const hemisphere = new THREE.HemisphereLight(0xfff5f2, 0x25213b, 2.3);
    const key = new THREE.DirectionalLight(0xffe4d8, 3.2);
    key.position.set(-1.5, 2.7, 2.4);
    const rim = new THREE.DirectionalLight(0xb8adff, 2.65);
    rim.position.set(1.7, 2.1, -1.5);
    const fill = new THREE.PointLight(0xff9baf, 1.1, 4);
    fill.position.set(1.1, 1.3, 1.4);
    scene.add(hemisphere, key, rim, fill);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.loadAsync(avatarAsset).then((gltf) => {
      const loadedVrm = gltf.userData.vrm as VRM | undefined;
      if (!active) {
        disposeObject(gltf.scene);
        return;
      }
      if (!loadedVrm) throw new Error("The anime avatar did not contain a VRM rig.");

      vrm = loadedVrm;
      avatar = loadedVrm.scene;
      avatar.name = "MiraOpenLicensedAnimeAvatar";
      VRMUtils.rotateVRM0(loadedVrm);
      prepareAvatar(avatar);

      const sourceBounds = new THREE.Box3().setFromObject(avatar);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      if (sourceSize.y > 0) avatar.scale.setScalar(1.72 / sourceSize.y);
      avatar.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(avatar);
      const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
      avatar.position.set(-fittedCenter.x, -fittedBounds.min.y, -fittedCenter.z);

      const humanoid = loadedVrm.humanoid;
      const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
      const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
      const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
      const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");
      if (leftUpperArm) leftUpperArm.rotation.set(.04, -.11, -1.18);
      if (rightUpperArm) rightUpperArm.rotation.set(.04, .11, 1.18);
      if (leftLowerArm) leftLowerArm.rotation.set(0, -.12, .08);
      if (rightLowerArm) rightLowerArm.rotation.set(0, .12, -.08);

      head = humanoid.getNormalizedBoneNode("head");
      neck = humanoid.getNormalizedBoneNode("neck");
      spine = humanoid.getNormalizedBoneNode("upperChest") ?? humanoid.getNormalizedBoneNode("chest");
      leftEye = humanoid.getNormalizedBoneNode("leftEye");
      rightEye = humanoid.getNormalizedBoneNode("rightEye");
      headBase = head?.rotation.clone() ?? null;
      neckBase = neck?.rotation.clone() ?? null;
      spineBase = spine?.rotation.clone() ?? null;
      spineBaseY = spine?.position.y ?? 0;
      leftEyeBase = leftEye?.rotation.clone() ?? null;
      rightEyeBase = rightEye?.rotation.clone() ?? null;

      // Some VRM 0 models define a bone-based look-at range that can turn the
      // irises completely away from the camera. Head and neck tracking below
      // provides natural gaze without corrupting the model's authored eyes.
      if (loadedVrm.lookAt) loadedVrm.lookAt.autoUpdate = false;

      scene.add(avatar);
      loadedVrm.humanoid.update();
      loadedVrm.expressionManager?.update();
      modelLoaded = true;
    }).catch((cause) => {
      console.warn("Anime VRM avatar failed to load", cause);
      if (active) setLoadState("fallback");
    });

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const compact = width < 720;
      camera.fov = compact ? 32 : 30;
      camera.position.set(0, compact ? 1.46 : 1.45, compact ? 1.58 : 1.43);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width - .5) * 2, -1, 1);
      pointerY = THREE.MathUtils.clamp(((event.clientY - bounds.top) / bounds.height - .5) * 2, -1, 1);
    };
    const onPointerLeave = () => { pointerX = 0; pointerY = 0; };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - lastFrameAt) / 1_000, .05);
      const elapsed = (now - startedAt) / 1_000;
      lastFrameAt = now;
      const state = stateRef.current;
      const pose = targetForPose(state.mouthPose);
      const expression = emotionTargets(state.emotion);

      if (vrm) {
        setExpression(vrm, "blink", state.blinking ? 1 : 0, state.blinking ? .76 : .34);
        setExpression(vrm, "aa", pose.aa, .4);
        setExpression(vrm, "ee", pose.ee, .4);
        setExpression(vrm, "ih", pose.ih, .4);
        setExpression(vrm, "oh", pose.oh, .4);
        setExpression(vrm, "ou", pose.ou, .4);
        setExpression(vrm, "happy", expression.happy, .11);
        setExpression(vrm, "relaxed", expression.relaxed, .11);
        setExpression(vrm, "sad", expression.sad, .11);
        setExpression(vrm, "angry", expression.angry, .11);
        setExpression(vrm, "surprised", expression.surprised, .11);

        const movement = reducedMotion ? 0 : state.speaking ? 1 : .42;
        if (spine && spineBase) {
          const breath = Math.sin(elapsed * 1.08) * .0045;
          spine.position.y = THREE.MathUtils.lerp(spine.position.y, spineBaseY + breath, .055);
          spine.rotation.x = spineBase.x + Math.sin(elapsed * 1.25) * .009 * movement;
          spine.rotation.z = spineBase.z + Math.sin(elapsed * .48) * .008;
        }
        if (neck && neckBase) {
          neck.rotation.y = THREE.MathUtils.lerp(neck.rotation.y, neckBase.y + pointerX * -.045 + Math.sin(elapsed * .34) * .014, .035);
          neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, neckBase.x + pointerY * .025 + Math.sin(elapsed * .53) * .007, .035);
        }
        if (head && headBase) {
          const conversationalNod = state.speaking
            ? Math.sin(elapsed * 2.05) * .016
            : state.listening ? Math.max(0, Math.sin(elapsed * .72)) * .009 : Math.sin(elapsed * .47) * .006;
          const thinkingTurn = state.thinking ? .045 : 0;
          head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, headBase.x + conversationalNod, .04);
          head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, headBase.y + thinkingTurn + pointerX * -.022, .032);
          head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, headBase.z + Math.sin(elapsed * .27) * .012, .035);
        }
        const eyeSaccadeX = reducedMotion ? 0 : Math.sin(elapsed * .83) * .012 + Math.sin(elapsed * 2.17) * .004;
        const eyeSaccadeY = reducedMotion ? 0 : Math.sin(elapsed * .57) * .006;
        for (const [eye, base] of [[leftEye, leftEyeBase], [rightEye, rightEyeBase]] as const) {
          if (!eye || !base) continue;
          eye.rotation.y = THREE.MathUtils.lerp(eye.rotation.y, base.y + pointerX * -.035 + eyeSaccadeX + (state.thinking ? .025 : 0), .08);
          eye.rotation.x = THREE.MathUtils.lerp(eye.rotation.x, base.x + pointerY * .018 + eyeSaccadeY, .08);
        }

        // The current VRM 1 avatar has a stable standards-compliant spring rig.
        // Its full update is required for MToon textures, expressions, constraints,
        // and secondary motion to remain synchronized.
        vrm.update(delta);
      }

      camera.lookAt(pointerX * -.012, 1.45 + pointerY * -.008, 0);
      renderer.render(scene, camera);
      if (modelLoaded && stableFrames < 12) {
        stableFrames += 1;
        if (stableFrames === 12 && active) setLoadState("ready");
      }
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
      <img className="live-avatar-3d__fallback" src="/assets/mira/avatar/mira-anime-live-v2.png" alt="" draggable={false} />
      <canvas ref={canvasRef} className="live-avatar-3d__canvas" role="img" aria-label={`${companionName}, an expressive open-licensed anime 3D companion`} />
      {loadState === "loading" ? <span className="live-avatar-3d__loading">Bringing {companionName} into the call…</span> : null}
      {loadState === "fallback" ? <span className="live-avatar-3d__loading">3D is unavailable on this device · using anime portrait mode</span> : null}
    </div>
  );
}
