function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function withBrowserHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; upgrade-insecure-requests",
    );
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      if (!env.BACKEND?.fetch) {
        return Response.json({ ok: false, error: { code: "backend_unavailable", message: "The beta API is temporarily unavailable." } }, { status: 503 });
      }
      return env.BACKEND.fetch(request);
    }

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml && ["GET", "HEAD"].includes(request.method)) {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/";
      indexUrl.search = "";
      return withBrowserHeaders(await env.ASSETS.fetch(new Request(indexUrl, request)));
    }
    return withBrowserHeaders(await env.ASSETS.fetch(request));
  },
};
