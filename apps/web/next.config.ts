import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' blob: https://api.openai.com https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/assets/mira/avatar/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@companion/ai", "@companion/config", "@companion/shared", "@companion/ui"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  webpack(config, { webpack }) {
    const nodeModuleShim = fileURLToPath(new URL("./lib/browser-node-module-shim.ts", import.meta.url));
    config.resolve.alias["node:module"] = nodeModuleShim;
    config.resolve.alias["@huggingface/transformers$"] = fileURLToPath(new URL("./node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url));
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:module$/, nodeModuleShim));
    return config;
  },
};

export default nextConfig;
