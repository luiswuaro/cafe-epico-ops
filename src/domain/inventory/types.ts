export const CANONICAL_UNITS = ["g", "ml", "pz"] as const;
export type CanonicalUnit = (typeof CANONICAL_UNITS)[number];
export function purchaseToCanonical(purchaseQuantity: number, canonicalQuantityPerPurchaseUnit: number) {
  if (purchaseQuantity < 0) throw new Error("Purchase quantity cannot be negative");
  if (canonicalQuantityPerPurchaseUnit <= 0) throw new Error("Conversion factor must be positive");
  return purchaseQuantity * canonicalQuantityPerPurchaseUnit;
}
export function deviation(physical: number, theoretical: number) {
  const quantity = physical - theoretical;
  const percentage = theoretical === 0 ? null : quantity / theoretical;
  return { quantity, percentage };
}
