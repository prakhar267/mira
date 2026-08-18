import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../pages/_worker.js";

test("Pages alias forwards API requests through the bound backend", async () => {
  let forwarded;
  const request = new Request("https://saathkind.pages.dev/api/v1/health", {
    headers: { accept: "application/json", origin: "https://saathkind.pages.dev" },
  });
  const response = await worker.fetch(request, {
    BACKEND: {
      fetch: async (nextRequest) => {
        forwarded = nextRequest;
        return Response.json({ ok: true, data: { status: "ok" } });
      },
    },
    ASSETS: { fetch: async () => new Response("unexpected", { status: 500 }) },
  });

  assert.equal(forwarded, request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, "ok");
});

test("Pages alias serves the SPA fallback with browser security headers", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://saathkind.pages.dev/app/settings", {
    headers: { accept: "text/html" },
  }), {
    BACKEND: { fetch: async () => new Response("unexpected", { status: 500 }) },
    ASSETS: {
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        calls.push(pathname);
        return pathname === "/"
          ? new Response("<!doctype html><title>Saathkind</title>", { headers: { "content-type": "text/html" } })
          : new Response("missing", { status: 404 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/"]);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("Pages alias fails closed when its backend binding is missing", async () => {
  const response = await worker.fetch(new Request("https://saathkind.pages.dev/api/v1/health"), {
    ASSETS: { fetch: async () => new Response("unexpected", { status: 500 }) },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "backend_unavailable");
});

test("Pages packaging emits the advanced worker and asset route exclusions", async () => {
  await access(new URL("../dist/client/_worker.js", import.meta.url));
  await access(new URL("../dist/client/_routes.json", import.meta.url));
  await access(new URL("../dist/client/404.html", import.meta.url));
});
