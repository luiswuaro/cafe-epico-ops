import {unstable_cache} from "next/cache";
import {and,eq,gte,isNull,sql} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {loyverseItems,loyverseVariants,loyverseCategories,loyverseReceipts,loyverseReceiptLines} from "@/src/infrastructure/db/schema";

/**
 * El antiguo Loyverse NO es el POS operativo.
 * Estas tres colecciones históricas rara vez cambian, pero antes se transferían
 * completas desde PostgreSQL cada vez que el POS se actualizaba.
 *
 * Caché de Next/Vercel compartida entre solicitudes (y regiones donde esté
 * soportada). El ID de organización es parte de la clave para aislar negocios.
 *
 * Sólo cachear los registros heredados: precios/recetas OPS, saldos nativos,
 * clientes, caja, comandas y permisos permanecen sin caché.
 * Un nuevo sync histórico de Loyverse puede reflejarse en hasta 5 minutos.
 */
export const LEGACY_LOYVERSE_CACHE_SECONDS=300;

export const getCachedLoyverseCatalogBase=unstable_cache(
  async (organizationId:string)=>{
    const db=getDb();
    const [items,variants,categories]=await Promise.all([
      db.select({
        externalId:loyverseItems.externalId,
        itemName:loyverseItems.itemName,
        payload:loyverseItems.payload,
      }).from(loyverseItems).where(and(
        eq(loyverseItems.organizationId,organizationId),
        isNull(loyverseItems.deletedAt),
      )),
      db.select({
        externalId:loyverseVariants.externalId,
        loyverseItemExternalId:loyverseVariants.loyverseItemExternalId,
        variantName:loyverseVariants.variantName,
        sku:loyverseVariants.sku,
        payload:loyverseVariants.payload,
      }).from(loyverseVariants).where(eq(loyverseVariants.organizationId,organizationId)),
      db.select({
        externalId:loyverseCategories.externalId,
        name:loyverseCategories.name,
      }).from(loyverseCategories).where(eq(loyverseCategories.organizationId,organizationId)),
    ]);
    return {items,variants,categories};
  },
  ["cafe-epico-loyverse-static-catalog-v1"],
  {revalidate:LEGACY_LOYVERSE_CACHE_SECONDS},
);

/** Popularidad histórica Loyverse: no cambia con ventas nativas OPS.
 * Se recalcula cada 5 minutos para evitar volver a sumar el histórico en cada POS.
 */
export const getCachedLoyversePopularity=unstable_cache(
  async (organizationId:string)=>{
    const db=getDb();
    const since=new Date(Date.now()-30*86_400_000);
    const itemNameExpr=sql<string>`${loyverseReceiptLines.payload}->>'item_name'`;
    return db.select({
      itemName:itemNameExpr,
      units:sql<string>`sum(${loyverseReceiptLines.quantity})::text`,
    }).from(loyverseReceiptLines)
      .innerJoin(loyverseReceipts,and(
        eq(loyverseReceipts.organizationId,loyverseReceiptLines.organizationId),
        eq(loyverseReceipts.externalId,loyverseReceiptLines.receiptExternalId),
      )).where(and(
        eq(loyverseReceipts.organizationId,organizationId),
        eq(loyverseReceipts.receiptType,"SALE"),
        gte(loyverseReceipts.receiptDate,since),
        sql`coalesce(${loyverseReceipts.payload}->>'cancelled_at','') = ''`,
      )).groupBy(itemNameExpr);
  },
  ["cafe-epico-loyverse-popularity-v1"],
  {revalidate:LEGACY_LOYVERSE_CACHE_SECONDS},
);
