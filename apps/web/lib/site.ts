export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://luma-companion.prakhargupta267.workers.dev").replace(/\/$/, "");

export const siteDescription =
  "Meet Mira, an adults-only AI companion for natural English and Hinglish conversation, hands-free voice, expressive avatar calls, and memory you control.";

export const privatePageMetadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
} as const;
