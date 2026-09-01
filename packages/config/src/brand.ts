export const brand = {
  internalName: "Luma",
  displayName: process.env.NEXT_PUBLIC_BRAND_NAME || "Luma",
  companionName: "Luma",
  promise: "A companion who feels present, remembers, and grows with you.",
  disclosure: "AI companion · Adults 18+",
  supportEmail: process.env.PUBLIC_SUPPORT_EMAIL || "support@example.invalid",
} as const;

export type BrandConfig = typeof brand;
