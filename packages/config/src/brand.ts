export const brand = {
  internalName: "Mira",
  displayName: process.env.NEXT_PUBLIC_BRAND_NAME || "Mira",
  companionName: "Mira",
  promise: "A companion who feels present, remembers, and grows with you.",
  disclosure: "AI companion · Adults 18+",
} as const;

export type BrandConfig = typeof brand;
