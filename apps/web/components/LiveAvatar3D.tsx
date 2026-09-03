"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type AvatarMouthPose = 0 | 1 | 2 | 3;
export type AvatarEmotion = "natural" | "happy" | "playful" | "tender" | "intimate" | "sad" | "angry";

const avatarAsset = "/assets/mira/avatar/mira-valid-woman.glb";

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

function isMorphMesh(object: THREE.Object3D): object is MorphMesh {
  return object instanceof THREE.Mesh
    && Boolean(object.morphTargetInfluences?.length)
    && Boolean(object.morphTargetDictionary);
}

function targetForPose(pose: AvatarMouthPose) {
  if (pose === 1) return { jaw: .11, funnel: 0, pucker: 0, stretch: .02, pp: .44, aa: 0, ou: 0, e: 0 };
  if (pose === 2) return { jaw: .28, funnel: 0, pucker: 0, stretch: .04, pp: 0, aa: .5, ou: 0, e: .08 };
  if (pose === 3) return { jaw: .17, funnel: .08, pucker: .06, stretch: 0, pp: 0, aa: 0, ou: .5, e: 0 };
  return { jaw: 0, funnel: 0, pucker: 0, stretch: 0, pp: 0, aa: 0, ou: 0, e: 0 };
}

function setNamedMorph(mesh: MorphMesh, name: string, target: number, smoothing = 0.24) {
  const index = mesh.morphTargetDictionary[name];
  if (index === undefined) return;
  const current = mesh.morphTargetInfluences[index] ?? 0;
  mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(current, target, smoothing);
}

function emotionTargets(emotion: AvatarEmotion) {
  if (emotion === "happy") return { smile: .21, frown: 0, innerBrow: .04, browDown: 0, squint: .07, press: 0 };
  if (emotion === "playful") return { smile: .14, frown: 0, innerBrow: .03, browDown: 0, squint: .1, press: 0 };
  if (emotion === "tender") return { smile: .07, frown: 0, innerBrow: .1, browDown: 0, squint: .035, press: 0 };
  if (emotion === "intimate") return { smile: .08, frown: 0, innerBrow: .04, browDown: .025, squint: .12, press: 0 };
  if (emotion === "sad") return { smile: 0, frown: .23, innerBrow: .29, browDown: 0, squint: .02, press: .05 };
  if (emotion === "angry") return { smile: 0, frown: .13, innerBrow: 0, browDown: .34, squint: .13, press: .2 };
  return { smile: .035, frown: 0, innerBrow: .025, browDown: 0, squint: .02, press: 0 };
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
    const morphMeshes: MorphMesh[] = [];
    let head: THREE.Object3D | null = null;
    let neck: THREE.Object3D | null = null;
    let spine: THREE.Object3D | null = null;
    let leftEye: THREE.Object3D | null = null;
    let rightEye: THREE.Object3D | null = null;
    let leftUpperArm: THREE.Object3D | null = null;
    let rightUpperArm: THREE.Object3D | null = null;
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

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.loadAsync(avatarAsset).then((gltf) => {
      if (!active) {
        disposeObject(gltf.scene);
        return;
      }

      avatar = gltf.scene;
      avatar.name = "MiraValidOpenAvatar";
      avatar.rotation.y = 0;
      avatar.position.set(0, 0, 0);

      const sourceBounds = new THREE.Box3().setFromObject(avatar);
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      if (sourceSize.y > 0) avatar.scale.setScalar(1.72 / sourceSize.y);
      avatar.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(avatar);
      const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
      avatar.position.set(-fittedCenter.x, -fittedBounds.min.y, -fittedCenter.z);

      avatar.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (isMorphMesh(object)) morphMeshes.push(object);
        object.frustumCulled = false;
        object.castShadow = false;
        object.receiveShadow = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          material.roughness = Math.max(material.roughness, .54);
          material.metalness = Math.min(material.metalness, .08);
          material.envMapIntensity = .42;
          if (/eyelash|hair/i.test(material.name)) material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        }
      });

      head = avatar.getObjectByName("Head") ?? null;
      neck = avatar.getObjectByName("Neck2") ?? avatar.getObjectByName("Neck") ?? null;
      spine = avatar.getObjectByName("Spine2") ?? null;
      leftEye = avatar.getObjectByName("LeftEye") ?? avatar.getObjectByName("h_L_eye") ?? null;
      rightEye = avatar.getObjectByName("RightEye") ?? avatar.getObjectByName("h_R_eye") ?? null;
      leftUpperArm = avatar.getObjectByName("LeftArm") ?? null;
      rightUpperArm = avatar.getObjectByName("RightArm") ?? null;
      if (leftUpperArm) leftUpperArm.rotation.set(1.16, -.01, -.2);
      if (rightUpperArm) rightUpperArm.rotation.set(1.16, .01, .2);
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
      const expression = emotionTargets(state.emotion);
      const blink = state.blinking ? 1 : 0;

      for (const mesh of morphMeshes) {
        setNamedMorph(mesh, "eyeBlinkLeft", blink, state.blinking ? .72 : .33);
        setNamedMorph(mesh, "eyeBlinkRight", blink, state.blinking ? .72 : .33);
        setNamedMorph(mesh, "jawOpen", pose.jaw, .38);
        setNamedMorph(mesh, "mouthClose", state.mouthPose === 0 ? .025 : 0, .3);
        setNamedMorph(mesh, "mouthFunnel", pose.funnel, .34);
        setNamedMorph(mesh, "mouthPucker", pose.pucker, .34);
        setNamedMorph(mesh, "mouthStretchLeft", pose.stretch, .34);
        setNamedMorph(mesh, "mouthStretchRight", pose.stretch, .34);
        setNamedMorph(mesh, "mouthLowerDownLeft", pose.jaw * .17, .32);
        setNamedMorph(mesh, "mouthLowerDownRight", pose.jaw * .17, .32);
        setNamedMorph(mesh, "PP", pose.pp, .42);
        setNamedMorph(mesh, "aa", pose.aa, .42);
        setNamedMorph(mesh, "ou", pose.ou, .42);
        setNamedMorph(mesh, "E", pose.e, .42);
        setNamedMorph(mesh, "mouthSmileLeft", expression.smile, .1);
        setNamedMorph(mesh, "mouthSmileRight", expression.smile, .1);
        setNamedMorph(mesh, "mouthFrownLeft", expression.frown, .1);
        setNamedMorph(mesh, "mouthFrownRight", expression.frown, .1);
        setNamedMorph(mesh, "browInnerUp", expression.innerBrow, .1);
        setNamedMorph(mesh, "browDownLeft", expression.browDown, .1);
        setNamedMorph(mesh, "browDownRight", expression.browDown, .1);
        setNamedMorph(mesh, "eyeSquintLeft", expression.squint, .1);
        setNamedMorph(mesh, "eyeSquintRight", expression.squint, .1);
        setNamedMorph(mesh, "mouthPressLeft", expression.press, .1);
        setNamedMorph(mesh, "mouthPressRight", expression.press, .1);
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
      if (avatar) avatar.position.y = Math.sin(elapsed * 1.28) * .0028;

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
      <canvas ref={canvasRef} className="live-avatar-3d__canvas" role="img" aria-label={`${companionName}, an expressive animated open-source 3D companion`} />
      {loadState === "loading" ? <span className="live-avatar-3d__loading">Bringing {companionName} into the call…</span> : null}
      {loadState === "fallback" ? <span className="live-avatar-3d__loading">3D is unavailable on this device · using portrait mode</span> : null}
    </div>
  );
}
