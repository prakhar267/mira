import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@companion/ui/tokens.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { brand } from "@companion/config";
import { ServiceWorker } from "@/components/ServiceWorker";
import { siteDescription, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${brand.displayName} — ${brand.promise}`,
    template: `%s · ${brand.displayName}`,
  },
  description: siteDescription,
  applicationName: brand.displayName,
  category: "lifestyle",
  keywords: ["AI companion", "Hinglish AI", "voice companion", "AI memory", "Mira"],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: brand.displayName,
    title: `${brand.displayName} — ${brand.promise}`,
    description: siteDescription,
    images: [{ url: "/assets/launch/mira-product-hunt-og.png", width: 1200, height: 630, alt: "Mira, an original AI companion" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.displayName} — ${brand.promise}`,
    description: siteDescription,
    images: ["/assets/launch/mira-product-hunt-og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171817",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}<ServiceWorker /></body>
    </html>
  );
}
