/**
 * Momento único de impresión de comandas por operación:
 * - Un pedido GUARDADO ya fue enviado a barra: imprime únicamente su ronda.
 * - Un pedido DIRECTO se envía al cobrar: imprime la orden completa.
 * - Un cobro POSTERIOR de un pedido guardado jamás genera otra comanda.
 *
 * Las preferencias siguen siendo locales a la estación con el puente ESC/POS.
 */
export type KitchenAutoEvent="saved"|"paid"|"paid-direct";
export type KitchenServiceMode="DINE_IN"|"TAKEAWAY";
export function autoKitchenModes(
  event:KitchenAutoEvent,
  enableDineIn:boolean,
  enableTakeaway:boolean,
):KitchenServiceMode[]{
  if(event==="paid")return [];
  return [
    ...(enableDineIn?["DINE_IN" as const]:[]),
    ...(enableTakeaway?["TAKEAWAY" as const]:[]),
  ];
}
