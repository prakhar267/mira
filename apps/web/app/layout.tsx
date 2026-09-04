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

export const metadata: Metadata = {
  title: `${brand.displayName} — ${brand.promise}`,
  description: "An original adults-only AI companion centered on memory, continuity, voice, and user control.",
  robots: { index: false, follow: false },
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
