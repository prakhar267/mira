import { assertEdgeSameOrigin, EdgeRequestError } from "@/lib/edge-security";

const MODEL_PATH_PREFIX = "onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";
const HUGGING_FACE_MODEL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    assertEdgeSameOrigin(request);
    const { path } = await context.params;
    const requestedPath = path.join("/");
    if (!requestedPath.startsWith(MODEL_PATH_PREFIX)) {
      return new Response("Unknown voice model asset.", { status: 404 });
    }

    const filename = requestedPath.slice(MODEL_PATH_PREFIX.length);
    if (!filename || filename.split("/").some((part) => !/^[a-zA-Z0-9._-]+$/.test(part))) {
      return new Response("Invalid voice model asset.", { status: 400 });
    }

    const upstreamHeaders = new Headers();
    const range = request.headers.get("range");
    if (range) upstreamHeaders.set("range", range);
    const upstream = await fetch(`${HUGGING_FACE_MODEL}${filename}`, {
      headers: upstreamHeaders,
      redirect: "follow",
    });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Voice model asset is temporarily unavailable.", {
        status: upstream.status === 404 ? 404 : 502,
        headers: { "cache-control": "no-store" },
      });
    }

    const headers = new Headers({
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["accept-ranges", "content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (cause) {
    const status = cause instanceof EdgeRequestError ? cause.status : 502;
    return new Response(
      cause instanceof EdgeRequestError ? cause.message : "Voice model asset is temporarily unavailable.",
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
