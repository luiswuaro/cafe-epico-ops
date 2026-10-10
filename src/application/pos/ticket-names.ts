import type {PosServiceMode} from "./catalog";

/** Nombres rápidos editables en el POS, independientes de los clientes de lealtad. */
export const DINE_IN_TICKET_PRESETS=[
  "Mesa 1","Mesa 2","Mesa 3","Mesa 4",
  "Mesa balcón 1","Mesa balcón 2",
] as const;
export const TAKEAWAY_TICKET_PRESETS=[
  "Para llevar 1","Para llevar 2","Para llevar 3","Para llevar 4",
] as const;

/** Las líneas de pedido tienen prioridad frente al selector predeterminado. */
export function effectiveOrderServiceMode(
  defaultMode:PosServiceMode,
  lines:ReadonlyArray<{serviceMode?:PosServiceMode}>,
):PosServiceMode{
  return lines.some(line=>(line.serviceMode??defaultMode)==="DINE_IN")
    ?"DINE_IN":"TAKEAWAY";
}

/** Nombre obligatorio para consumir aquí; vacío permitido para numeración automática para llevar. */
export function validateTicketLabel(mode:PosServiceMode,raw:string|null|undefined):string|null{
  const value=(raw??"").trim();
  if(value.length>100 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error("El nombre del ticket debe tener máximo 100 caracteres y estar en una sola línea.");
  if(mode==="DINE_IN"&&!value)
    throw new Error("Para consumo aquí, selecciona una mesa o escribe un nombre personalizado.");
  return value||null;
}

/** Secuencia de tickets creados hoy en la sucursal, asignada bajo candado transaccional. */
export function dailyTakeawayTicketLabel(number:number):string{
  if(!Number.isSafeInteger(number)||number<1)
    throw new Error("Número de pedido inválido.");
  return "Para llevar #"+String(number).padStart(3,"0");
}
