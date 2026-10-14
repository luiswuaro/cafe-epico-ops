import {unstable_cache} from "next/cache";
import {sql} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";

/** Importación histórica de compatibilidad, congelada dentro de OPS.
 * A partir de esta versión jamás se consultan las tablas Loyverse desde
 * el catálogo operativo. El archivo se crea por migración SQL 0028.
 * Modificadores/recetas/precios/stock en OPS permanecen EN VIVO.
 */
export const LEGACY_LOYVERSE_CACHE_SECONDS=12*60*60;
export const OPS_ARCHIVE_TAG="cafe-epico-ops-archive";

type ArchivedItem={
  externalId:string;itemName:string;payload:Record<string,unknown>;
};
type ArchivedVariant={
  externalId:string;loyverseItemExternalId:string|null;
  variantName:string|null;sku:string|null;payload:Record<string,unknown>;
};
type ArchivedCategory={externalId:string;name:string};
type ArchivedUnitSetting={
  variantExternalId:string;displayUnit:string|null;displayFactor:string|number|null;
  unitCostOverride:string|number|null;packagePrice:string|number|null;
  packageQuantityNative:string|number|null;
};
type ArchivedPopularity={itemName:string|null;units:string};

type Snapshot={
  items:ArchivedItem[];variants:ArchivedVariant[];
  categories:ArchivedCategory[];settings:ArchivedUnitSetting[];
  popularity:ArchivedPopularity[];
};

export const getCachedLoyverseCatalogBase=unstable_cache(
  async(organizationId:string):Promise<Snapshot>=>{
    // Una sola fila de OPS, sin queries, joins ni egress desde
    // los originales Loyverse después de la migración.
    const rows=await getDb().execute(sql`
      select items,variants,categories,settings,popularity
      from public.ops_catalog_archive_snapshots
      where organization_id=${organizationId}::uuid
      limit 1
    `);
    const snapshot=rows[0] as Snapshot|undefined;
    if(!snapshot||!Array.isArray(snapshot.items)||
      !Array.isArray(snapshot.variants)||!Array.isArray(snapshot.categories)||
      !Array.isArray(snapshot.settings)||!Array.isArray(snapshot.popularity)){
      // Fallo explícito en vez de servir un menú incompleto o cambiar precios.
      throw new Error("Falta la copia del catálogo en OPS. No editar ni cobrar con un menú incompleto.");
    }
    return snapshot;
  },
  ["cafe-epico-ops-archived-catalog-v1"],
  {revalidate:LEGACY_LOYVERSE_CACHE_SECONDS,tags:[OPS_ARCHIVE_TAG]},
);

/** Popularidad del momento de migración; las ventas desde octubre pertenecen a OPS. */
export async function getCachedLoyversePopularity(organizationId:string){
  const snapshot=await getCachedLoyverseCatalogBase(organizationId);
  return snapshot.popularity;
}
