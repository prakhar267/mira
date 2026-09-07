import { CompanionApp } from "@/components/CompanionApp";
import { privatePageMetadata } from "@/lib/site";

export const metadata = privatePageMetadata;

export default function AppPage() {
  return <CompanionApp productionAccount />;
}
