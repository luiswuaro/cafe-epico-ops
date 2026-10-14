import assert from "node:assert/strict";
import fs from "node:fs";

const files={
 migration:fs.readFileSync("db/migrations/0028_ops_catalog_archive_snapshot.sql","utf8"),
 schema:fs.readFileSync("src/infrastructure/db/schema.ts","utf8"),
 source:fs.readFileSync("src/application/loyverse/cached-catalog-base.ts","utf8"),
 recipes:fs.readFileSync("src/application/loyverse/recipes.ts","utf8"),
 catalog:fs.readFileSync("src/application/pos/catalog.ts","utf8"),
 finance:fs.readFileSync("src/application/finance/preview.ts","utf8"),
 client:fs.readFileSync("src/infrastructure/db/client.ts","utf8"),
 employee:fs.readFileSync("src/infrastructure/auth/current-employee.ts","utf8"),
 board:fs.readFileSync("app/(employee)/pos/orders/auto-refresh.tsx","utf8"),
 health:fs.readFileSync("components/print-station-health-banner.tsx","utf8"),
 printer:fs.readFileSync("app/(employee)/pos/printer/print-station.tsx","utf8"),
};

assert.match(files.schema,/pgTable\("ops_catalog_archive_snapshots"/);
assert.match(files.migration,/CREATE TABLE IF NOT EXISTS ops_catalog_archive_snapshots/);
assert.match(files.migration,/ALTER TABLE public\.ops_catalog_archive_snapshots ENABLE ROW LEVEL SECURITY/);
assert.match(files.migration,/REVOKE ALL ON TABLE public\.ops_catalog_archive_snapshots FROM anon, authenticated/);
assert.match(files.migration,/ON CONFLICT\(organization_id\) DO NOTHING/);
for(const field of ["externalId","itemName","loyverseItemExternalId","variantName",
 "sku","payload","variantExternalId","displayUnit","displayFactor","unitCostOverride",
 "packageQuantityNative","packagePrice","itemName","units"]){
 assert.ok(files.migration.includes("'"+field+"'"),"Campo faltante en snapshot: "+field);
}
assert.doesNotMatch(files.migration,/\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+public\.)\b/i,
 "La migración nunca debe alterar/borrar registros de caja, recetas o inventario");
assert.match(files.source,/ops_catalog_archive_snapshots/);
assert.match(files.source,/revalidate:LEGACY_LOYVERSE_CACHE_SECONDS/);
assert.match(files.source,/12\*60\*60/);
assert.doesNotMatch(files.source,/\.from\(loyverse/);
assert.match(files.recipes,/getCachedLoyverseCatalogBase\(organizationId\)/);
assert.doesNotMatch(files.recipes,/\.from\(loyverse/);
assert.match(files.catalog,/\.from\(posCatalogOverrides\)/);
assert.match(files.catalog,/\.from\(posManualProducts\)/);
assert.match(files.finance,/getCachedLoyverseCatalogBase\(organizationId\)/);
assert.doesNotMatch(files.finance,/\.from\(loyverse/);
assert.match(files.employee,/cache\(async function getCurrentEmployee/);
assert.match(files.employee,/supabase\.auth\.getUser\(\)/,
 "No cachear usuarios/permisos entre peticiones ni sustituir verificación Auth");
assert.match(files.client,/max: 3, idle_timeout: 20/);
assert.match(files.board,/document\.visibilityState==="visible"/);
assert.match(files.health,/document\.visibilityState!=="visible"/);
assert.match(files.printer,/window\.setInterval\(\(\)=>void tick\(\),4000\)/,
 "La escucha de comandas debe permanecer activa incluso en segundo plano");
console.log("OPS Free architecture: PASS (copia privada, caja en vivo, autorizacion segura, pool corto, comandas activas)");
