/** Los previews Vercel usan la base compartida hasta contar con una BD staging.
 * Evita movimientos reales desde versiones de revisión.
 */
export function assertNoPreviewMutation(){
  if(process.env.VERCEL_ENV==="preview"){
    throw new Error("PREVIEW · SOLO LECTURA. Para proteger los datos de producción, aquí no se registran ventas, caja ni inventario. Revisa pantallas y recetas; opera en producción.");
  }
}
