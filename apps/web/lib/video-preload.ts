/** Static code only. No avatar download, WebGL, microphone, session or provider
 * request until the call actually opens. Failed hints never break a later call. */
export function createVideoPreload(load: () => Promise<unknown>) {
  let pending: Promise<unknown> | undefined;
  return () => {
    if (typeof window === "undefined") return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    pending ??= load().catch(() => { pending = undefined; });
  };
}

export const preloadVideoCall = createVideoPreload(() => Promise.all([
  import("../components/VideoCallModal"),
  import("../components/LiveAvatar3D"),
]));
