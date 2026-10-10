/**
 * Termo propio (takeaway only).
 *
 * The customer buys a beverage with their own container:
 * - The POS grants a fixed $5.00 MXN discount per beverage.
 * - The recipe does NOT consume disposable presentation items.
 * - The usual drink ingredients and extras are always consumed.
 * This module is browser-safe and contains no database dependencies.
 */
export const OWN_CONTAINER_DISCOUNT_MXN=5;

type ItemKind={category:string};
type Component={name:string;category?:string|null};

export function canUseOwnContainer(item:ItemKind,mode:string){
  return mode==="TAKEAWAY"&&(item.category==="CALIENTES"||item.category==="FRÍAS");
}

export function isOwnContainerDisposable(component:Component){
  const label=component.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/\s+/g," ");
  // Packaging and other single-use presentation items, never drink ingredients.
  return /\b(VASOS?|TAPAS?|MANGAS?|FAJILLAS?|POPOTES?|PAJILLAS?|SERVILLETAS?|AGITADORES?|PORTAVASOS?|BOLSAS?)\b/.test(label);
}

export function preparedOwnContainerComponents<T extends Component>(
  components:T[],enabled:boolean,
):T[]{
  return enabled?components.filter(c=>!isOwnContainerDisposable(c)):components;
}

export function ownContainerUnitPrice(
  basePrice:number,extrasPrice:number,enabled:boolean,
):number {
  return Math.round((basePrice+extrasPrice-(enabled?OWN_CONTAINER_DISCOUNT_MXN:0))*100)/100;
}

export function isOwnContainerSnapshot(expected:unknown):boolean {
  return !!expected && typeof expected==="object" && !Array.isArray(expected) &&
    (expected as Record<string,unknown>).customerContainer===true;
}

/** A normal takeaway recipe may be marked not-ready due solely to its packaging
 *  stock. The thermo customer does not need those packaging units. */
export function ownContainerReadinessErrors(errors:string[],enabled:boolean):string[]{
  return enabled?errors.filter(error=>!isOwnContainerDisposable({name:error})):errors;
}
