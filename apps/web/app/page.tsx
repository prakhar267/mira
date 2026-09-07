import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingPage";
import { siteDescription, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    images: [{ url: "/assets/launch/mira-product-hunt-og.png", width: 1200, height: 630, alt: "Mira, an original AI companion" }],
  },
};

export default function HomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Mira",
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Web",
    url: siteUrl,
    description: siteDescription,
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "Free public beta" },
  };

  return <><MarketingPage /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /></>;
}
