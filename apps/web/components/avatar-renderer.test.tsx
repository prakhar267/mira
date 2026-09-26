// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";
import { LiveAvatar3D, type AvatarEmotion } from "./LiveAvatar3D";
const gpu = vi.hoisted(() => ({
  fail: false,
  latest: null as unknown,
  parse: vi.fn(),
  fetch: vi.fn(),
  rotate: vi.fn(),
  skeleton: vi.fn(),
  morphs: vi.fn(),
}));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      outputColorSpace = "";
      toneMapping = 0;
      toneMappingExposure = 0;
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = vi.fn();
      dispose = vi.fn();
      constructor() {
        if (gpu.fail) throw Error("WebGL unavailable");
        gpu.latest = this;
      }
    },
  };
});
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    register = vi.fn((factory: (parser: unknown) => unknown) => {
      factory({});
    });
    parseAsync = gpu.parse;
  },
}));
vi.mock("@pixiv/three-vrm", async (original) => ({
  ...(await original<typeof import("@pixiv/three-vrm")>()),
  VRMLoaderPlugin: class {},
  VRMUtils: {
    rotateVRM0: gpu.rotate,
    combineSkeletons: gpu.skeleton,
    combineMorphs: gpu.morphs,
  },
}));
vi.mock("@/lib/avatar-delivery", () => ({
  avatarDelivery: { portraitPath: "/portrait.png" },
  fetchAvatarDelivery: gpu.fetch,
}));
let frameId = 0,
  time = 0,
  width = 800,
  height = 600,
  reduced = false;
let frames: Map<number, FrameRequestCallback>,
  resize: () => void,
  disconnect: ReturnType<typeof vi.fn>;
const props = {
  companionName: "Mira",
  speaking: false,
  thinking: false,
  listening: false,
  blinking: false,
  mouthPose: 0 as const,
};
function asset(minimal = false) {
  const root = new THREE.Group(),
    texture = new THREE.Texture(),
    geometry = new THREE.BoxGeometry(0.3, 1.7, 0.2),
    material = new THREE.MeshBasicMaterial({ map: texture }),
    outline = new MToonMaterial();
  outline.isOutline = true;
  if (!minimal) root.add(new THREE.Mesh(geometry, [material, outline]));
  const skeleton = new THREE.Skeleton([]),
    skinned = new THREE.SkinnedMesh(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute([], 3),
      ),
      new THREE.MeshBasicMaterial(),
    );
  skinned.skeleton = skeleton;
  root.add(skinned);
  const bones = Object.fromEntries(
    [
      "head",
      "neck",
      "chest",
      "leftEye",
      "rightEye",
      "leftUpperArm",
      "rightUpperArm",
      "leftLowerArm",
      "rightLowerArm",
    ].map((name) => [name, new THREE.Object3D()]),
  );
  const values = new Map<string, number>();
  const expressionManager = {
    getValue: vi.fn((name: string) => values.get(name)),
    setValue: vi.fn((name: string, value: number) => values.set(name, value)),
    update: vi.fn(),
  };
  const vrm = {
    scene: root,
    humanoid: {
      getNormalizedBoneNode: vi.fn((name: string) =>
        minimal ? null : (bones[name] ?? null),
      ),
      update: vi.fn(),
    },
    ...(minimal ? {} : { expressionManager, lookAt: { autoUpdate: true } }),
    update: vi.fn(),
  };
  const disposeGeometry = vi.spyOn(geometry, "dispose"),
    disposeTexture = vi.spyOn(texture, "dispose"),
    disposeMaterial = vi.spyOn(material, "dispose"),
    disposeSkeleton = vi.spyOn(skeleton, "dispose");
  return {
    gltf: { scene: root, userData: { vrm } },
    root,
    vrm,
    expressionManager,
    outline,
    disposeGeometry,
    disposeTexture,
    disposeMaterial,
    disposeSkeleton,
  };
}
const tick = async (ms = 60) => {
  time += ms;
  const queued = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of queued) callback(time);
  });
};
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  gpu.fail = false;
  gpu.latest = null;
  gpu.fetch.mockResolvedValue(new ArrayBuffer(8));
  frames = new Map();
  frameId = 0;
  time = 0;
  width = 800;
  height = 600;
  reduced = false;
  disconnect = vi.fn();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => ({
    width,
    height,
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    right: width,
    bottom: height,
    toJSON() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
  }));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("3D avatar renderer lifecycle", () => {
  it("fits and renders the VRM, drives every expression and disposes GPU resources", async () => {
    const model = asset();
    gpu.parse.mockResolvedValueOnce(model.gltf);
    const view = render(<LiveAvatar3D {...props} />);
    expect(screen.getByText(/Bringing Mira/)).toBeTruthy();
    await settle();
    expect(console.warn).not.toHaveBeenCalled();
    await tick();
    expect(
      screen.getByRole("img", { name: /expressive open-licensed/ }),
    ).toBeTruthy();
    expect(gpu.rotate).toHaveBeenCalledWith(model.vrm);
    expect(model.outline.visible).toBe(false);
    expect(model.vrm.lookAt?.autoUpdate).toBe(false);
    const canvas = document.querySelector("canvas")!;
    fireEvent(
      canvas,
      new MouseEvent("pointermove", { clientX: 250, clientY: 120 }),
    );
    for (const emotion of [
      "natural",
      "happy",
      "playful",
      "tender",
      "intimate",
      "sad",
      "angry",
    ] as AvatarEmotion[])
      for (const mouthPose of [0, 1, 2, 3] as const) {
        view.rerender(
          <LiveAvatar3D
            {...props}
            speaking
            thinking
            blinking
            listening
            emotion={emotion}
            mouthPose={mouthPose}
          />,
        );
        await tick();
      }
    expect(model.expressionManager.setValue).toHaveBeenCalledWith(
      "angry",
      expect.any(Number),
    );
    expect(model.expressionManager.setValue).toHaveBeenCalledWith(
      "ou",
      expect.any(Number),
    );
    fireEvent(canvas, new MouseEvent("pointerleave"));
    view.rerender(<LiveAvatar3D {...props} listening />);
    await tick(100);
    view.rerender(<LiveAvatar3D {...props} thinking />);
    await tick(100);
    reduced = true;
    await tick(120);
    reduced = false;
    await tick(1);
    width = 400;
    height = 700;
    act(() => resize());
    width = 0;
    height = 0;
    act(() => resize());
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick(100);
    view.unmount();
    expect(model.disposeGeometry).toHaveBeenCalled();
    expect(model.disposeTexture).toHaveBeenCalled();
    expect(model.disposeMaterial).toHaveBeenCalled();
    expect(model.disposeSkeleton).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(
      (gpu.latest as { dispose: ReturnType<typeof vi.fn> }).dispose,
    ).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it("renders missing optional bones safely and uses the already-started download", async () => {
    const model = asset(true);
    gpu.parse.mockResolvedValueOnce(model.gltf);
    const download = Promise.resolve(new ArrayBuffer(8));
    render(<LiveAvatar3D {...props} download={download} />);
    await settle();
    await tick(120);
    expect(gpu.fetch).not.toHaveBeenCalled();
    expect(model.vrm.update).toHaveBeenCalled();
    expect(screen.getByRole("img", { name: /expressive/ })).toBeTruthy();
  });
  it("keeps the portrait if the GPU cannot initialize", () => {
    gpu.fail = true;
    render(<LiveAvatar3D {...props} />);
    expect(screen.getByText(/3D is unavailable/)).toBeTruthy();
    expect(gpu.fetch).not.toHaveBeenCalled();
  });
  it.each(["download", "invalid rig"])(
    "falls back after %s failure",
    async (failure) => {
      if (failure === "download")
        gpu.fetch.mockRejectedValueOnce(Error("offline"));
      else
        gpu.parse.mockResolvedValueOnce({
          scene: new THREE.Group(),
          userData: {},
        });
      render(<LiveAvatar3D {...props} />);
      await settle();
      expect(screen.getByText(/3D is unavailable/)).toBeTruthy();
      expect(frames.size).toBe(0);
    },
  );
  it("stops rendering on context loss", async () => {
    gpu.parse.mockResolvedValueOnce(asset().gltf);
    render(<LiveAvatar3D {...props} />);
    await settle();
    await tick();
    fireEvent(document.querySelector("canvas")!, new Event("webglcontextlost"));
    expect(screen.getByText(/3D is unavailable/)).toBeTruthy();
    expect(frames.size).toBe(0);
  });
  it("disposes a late parsed model and suppresses post-unmount fetch errors", async () => {
    const model = asset();
    let resolve!: (v: unknown) => void;
    gpu.parse.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const v = render(<LiveAvatar3D {...props} />);
    await settle();
    v.unmount();
    await act(async () => resolve(model.gltf));
    expect(model.disposeGeometry).toHaveBeenCalled();
    let reject!: (cause: Error) => void;
    gpu.fetch.mockImplementationOnce(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    );
    const v2 = render(<LiveAvatar3D {...props} />);
    v2.unmount();
    await act(async () => reject(Error("aborted")));
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("reduces GPU resolution and pauses animation when sustained frames are too slow", async () => {
    gpu.parse.mockResolvedValueOnce(asset().gltf);
    render(<LiveAvatar3D {...props} speaking />);
    await settle();
    await tick();
    for (let n = 0; n < 60 && frames.size; n++) await tick(n < 20 ? 120 : 200);
    expect(screen.getByText(/Animation paused/)).toBeTruthy();
    expect(
      (gpu.latest as { setPixelRatio: ReturnType<typeof vi.fn> }).setPixelRatio
        .mock.calls.length,
    ).toBeGreaterThan(1);
  });
});
