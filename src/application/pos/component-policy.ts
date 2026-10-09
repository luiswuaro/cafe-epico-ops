import type { PosRecipeComponent } from "@/src/application/pos/catalog";

/**
 * Política explícita Café Épico: el agua potable se conserva en la receta
 * para escandallo, pero NO tiene existencia ni movimientos descontables.
 * Las referencias identifican el INSUMO de Loyverse, no cualquier producto
 * cuyo nombre contenga "agua" (p. ej. agua embotellada a la venta).
 */
const WATER_VARIANT_ID = "976e2d13-eefa-4a36-b1f5-b29f9ddb2bb0";
const WATER_ITEM_ID = "eab0af54-b569-4b87-bb65-e12b84bc7797";

export function isCostOnlyComponent(component: Pick<
  PosRecipeComponent,
  "variantExternalId" | "itemExternalId"
>) {
  return (
    component.variantExternalId === WATER_VARIANT_ID &&
    component.itemExternalId === WATER_ITEM_ID
  );
}

/**
 * Tarifa confirmada por el propietario: garrafón de 19 L a $26 MXN.
 * Aproximación técnica: densidad de agua = 1 g/ml. No controla existencias.
 * Mantener el costo y su base histórica en el snapshot de cada ticket.
 */
export const WATER_COST_BASIS = {
  packagePriceMxn: 26,
  packageLiters: 19,
  assumedDensityGPerMl: 1,
  source: "OWNER_CONFIRMED_2026-10-08",
} as const;
const waterGramsPerContainer = WATER_COST_BASIS.packageLiters * 1000 *
  WATER_COST_BASIS.assumedDensityGPerMl;
export const WATER_COST_PER_G_MXN = WATER_COST_BASIS.packagePriceMxn / waterGramsPerContainer;

/** Captura cantidad y costo histórico de agua, sin crear movimientos de inventario. */
export function costOnlyRecipeMeasure(component: PosRecipeComponent, quantity: number) {
  if (!isCostOnlyComponent(component)) return null;
  // Las recetas Loyverse expresan agua en kg. OPS calcula gramos.
  const grams = Math.round(quantity * 1_000_000) / 1_000;
  return {
    quantity: grams,
    unit: "g" as const,
    estimatedUnitCostMxn: WATER_COST_PER_G_MXN,
    estimatedCostMxn: Math.round(grams * WATER_COST_PER_G_MXN * 10_000) / 10_000,
    costBasis: WATER_COST_BASIS,
    pricingStatus: "COSTED_APPROX_DENSITY" as const,
  };
}
