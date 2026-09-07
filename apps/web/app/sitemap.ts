import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

const publicRoutes = ["", "/features", "/memory", "/voice", "/safety", "/pricing", "/privacy", "/terms", "/support"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return publicRoutes.map((route, index) => ({
    url: `${siteUrl}${route}`,
    lastModified: now,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : route === "/features" ? 0.9 : 0.7,
  }));
}
