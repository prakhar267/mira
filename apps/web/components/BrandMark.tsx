import { Sparkle } from "lucide-react";
import { brand } from "@companion/config";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-mark" aria-label={brand.displayName}>
      {compact ? <span className="brand-monogram">L</span> : <span>{brand.displayName}</span>}
      <Sparkle aria-hidden="true" size={compact ? 12 : 15} strokeWidth={1.8} />
    </span>
  );
}
