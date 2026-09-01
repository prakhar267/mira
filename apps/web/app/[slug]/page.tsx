import { notFound } from "next/navigation";
import { PublicInfoPage } from "@/components/PublicInfoPage";

const slugs = ["features", "memory", "voice", "safety", "pricing", "privacy", "terms"] as const;
type Slug = (typeof slugs)[number];

export function generateStaticParams() {
  return slugs.map((slug) => ({ slug }));
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugs.includes(slug as Slug)) notFound();
  return <PublicInfoPage slug={slug as Slug} />;
}
