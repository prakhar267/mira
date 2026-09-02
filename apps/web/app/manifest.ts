import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mira — AI companion",
    short_name: "Mira",
    description: "An adults-only AI companion with inspectable memory, voice, activities, and user-controlled privacy.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#171817",
    categories: ["lifestyle", "productivity"],
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
