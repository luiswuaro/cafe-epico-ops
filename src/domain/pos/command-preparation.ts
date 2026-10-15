/** La fase de barra es independiente del cobro y se calcula por ronda.
 * READY es terminal: el clic tardío en PREPARING no puede revertirla.
 * No se inventa una hora PREPARING cuando el barista marca READY directamente.
 */
export type NextPreparationStatus="PREPARING"|"READY";

export function commandPreparationDecision(
  currentStatus:string,
  nextStatus:NextPreparationStatus,
  roundStatuses:readonly string[],
){
  const alreadyReady=currentStatus==="READY"||roundStatuses.includes("READY");
  const alreadyPreparing=currentStatus==="PREPARING"||roundStatuses.includes("PREPARING");
  return {
    shouldRecord:!alreadyReady&&currentStatus!==nextStatus&&
      !(nextStatus==="PREPARING"&&alreadyPreparing),
    // READY implica preparación completada incluso si el inicio manual faltó.
    // El tiempo principal se mide con el evento real de impresión.
    preparingSkipped:nextStatus==="READY"&&!alreadyPreparing,
  };
}
