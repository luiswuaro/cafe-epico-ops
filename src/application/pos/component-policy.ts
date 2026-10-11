import type { PosRecipeComponent } from "@/src/application/pos/catalog";

/**
 * Insumos de costo que no deben bloquear cobro por falta de existencias.
 * Comparamos identificadores de artículo + variante, no nombres genéricos:
 * agua embotellada y productos de hielo a la venta siguen siendo controlables.
 */
const WATER = {
  variantId: "976e2d13-eefa-4a36-b1f5-b29f9ddb2bb0",
  itemId: "eab0af54-b569-4b87-bb65-e12b84bc7797",
} as const;
const ICE = {
  variantId: "24541734-9262-45d9-8190-b7c19d71a048",
  itemId: "9577abe2-ada4-403b-bc55-6de87fc53438",
} as const;

export type CostOnlyCode = "WATER" | "ICE";
type ComponentIdentity = Pick<PosRecipeComponent, "variantExternalId" | "itemExternalId"> &
  Partial<Pick<PosRecipeComponent,
    "costOnlyCode" | "name" | "inventoryItemId" | "inventoryLocationId" | "unitLabel">>;

function matches(component: ComponentIdentity, item:{variantId:string;itemId:string}) {
  return component.variantExternalId === item.variantId &&
    component.itemExternalId === item.itemId;
}
function unnamedLegacyCode(component:ComponentIdentity): CostOnlyCode | null {
  // La receta histórica puede omitir ambos IDs. No confundir AGUA MINERAL,
  // AGUA TÓNICA ni otros productos comercializables con el agua de preparación.
  if(component.variantExternalId || component.itemExternalId ||
    component.inventoryItemId || component.inventoryLocationId)return null;
  const name=(component.name??"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
  if(name==="AGUA")return "WATER";
  if(name==="HIELO")return "ICE";
  return null;
}
export function costOnlyComponentCode(component:ComponentIdentity):CostOnlyCode|null {
  if(component.costOnlyCode==="WATER" || component.costOnlyCode==="ICE")
    return component.costOnlyCode;
  if(matches(component,WATER))return "WATER";
  if(matches(component,ICE))return "ICE";
  return unnamedLegacyCode(component);
}
export function isCostOnlyComponent(component: ComponentIdentity) {
  return costOnlyComponentCode(component)!==null;
}
export function costOnlyComponentName(component:ComponentIdentity): "Agua" | "Hielo" | null {
  const code=costOnlyComponentCode(component);
  return code==="WATER"?"Agua":code==="ICE"?"Hielo":null;
}

/** Precio de agua declarado por el propietario: garrafón de 19 L a $26 MXN. */
export const WATER_COST_BASIS = {
  packagePriceMxn: 26,
  packageLiters: 19,
  assumedDensityGPerMl: 1,
  source: "OWNER_CONFIRMED_2026-10-08",
} as const;

const waterGramsPerContainer = WATER_COST_BASIS.packageLiters * 1000 *
  WATER_COST_BASIS.assumedDensityGPerMl;
export const WATER_COST_PER_G_MXN =
  WATER_COST_BASIS.packagePriceMxn / waterGramsPerContainer;

/**
 * El hielo se fabrica en Café Épico. No usar precio del agua como si fuera
 * costo completo: faltan kWh/kg real, rendimiento, mantenimiento y merma.
 */
export const ICE_COST_BASIS = {
  source: "ICE_MACHINE_OWN_PRODUCTION",
  requires: ["agua", "energia_kwh_por_kg", "mantenimiento", "merma"] as const,
} as const;

/**
 * Loyverse captura agua e hielo por kg. OPS conserva el peso de receta en g
 * para escandallos/snapshots pero nunca genera movimientos de existencias.
 */
export function costOnlyRecipeMeasure(component:PosRecipeComponent, quantity:number) {
  const name=costOnlyComponentName(component);
  if(!name)return null;
  // Loyverse guardaba kg como "peso/volumen"; las recetas OPS guardan g.
  // Mantener la misma cantidad física al convertir una receta.
  const legacyKg=component.unitLabel==="peso/volumen" || component.unitLabel==="kg";
  const grams=Math.round(quantity*(legacyKg?1000:1)*1000)/1000;
  if(name==="Agua"){
    return {
      ingredient:name,
      quantity:grams,
      unit:"g" as const,
      estimatedUnitCostMxn:WATER_COST_PER_G_MXN as number|null,
      estimatedCostMxn:Math.round(grams*WATER_COST_PER_G_MXN*10_000)/10_000 as number|null,
      costBasis:WATER_COST_BASIS,
      pricingStatus:"COSTED_APPROX_DENSITY" as const,
    };
  }
  return {
    ingredient:name,
    quantity:grams,
    unit:"g" as const,
    estimatedUnitCostMxn:null,
    estimatedCostMxn:null,
    costBasis:ICE_COST_BASIS,
    pricingStatus:"PENDING_UNIT_COST" as const,
  };
}
