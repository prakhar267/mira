import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@companion/ai", "@companion/config", "@companion/shared", "@companion/ui"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
