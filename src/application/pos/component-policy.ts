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
  "variantExternalId" | "itemExternalId" | "name"
>) {
  return (
    component.variantExternalId === WATER_VARIANT_ID &&
    component.itemExternalId === WATER_ITEM_ID &&
    component.name.trim().toLocaleUpperCase("es-MX") === "AGUA"
  );
}

/** Valor técnico, no financiero: precio por gramo pendiente de configurar. */
export function costOnlyRecipeMeasure(component: PosRecipeComponent, quantity: number) {
  if (!isCostOnlyComponent(component)) return null;
  // Agua en recetas Loyverse se expresa como kg. OPS pesa en gramos.
  return {
    quantity: Math.round(quantity * 1000 * 1000) / 1000,
    unit: "g" as const,
    pricingStatus: "PENDING_UNIT_COST" as const,
  };
}
