/** La estación sólo puede enviar trabajos automáticamente durante 5 minutos.
 * Inspeccionar 24 horas de órdenes y auditorías cada 4 s consume gigabytes.
 * Conservar 15 minutos de contexto permite detectar vencimientos recientes,
 * sin reclamar trabajos antiguos (que sólo se imprimen manualmente).
 */
export const PRINT_FEED_WINDOW_MS=15*60*1000;
export const AUTO_PRINT_WINDOW_MS=5*60*1000;
export function efficientPrintFeedSince(stationStart:Date,now=new Date()):Date{
  return new Date(Math.max(stationStart.getTime(),now.getTime()-PRINT_FEED_WINDOW_MS));
}
