import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingPage";
import { siteDescription, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
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
