import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/PublicInfoPage";

const slugs = ["features", "memory", "voice", "safety", "pricing", "privacy", "terms", "support"] as const;
type Slug = (typeof slugs)[number];

const titles: Record<Slug, string> = {
  features: "Features",
  memory: "Memory you control",
  voice: "Voice and avatar calls",
  safety: "Safety",
  pricing: "Free public beta",
  privacy: "Privacy",
  terms: "Beta terms",
  support: "Support",
};

export function generateStaticParams() {
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!slugs.includes(slug as Slug)) return {};
  return { title: titles[slug as Slug], alternates: { canonical: `/${slug}` }, openGraph: { url: `/${slug}` } };
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugs.includes(slug as Slug)) notFound();
  return <PublicInfoPage slug={slug as Slug} />;
}
