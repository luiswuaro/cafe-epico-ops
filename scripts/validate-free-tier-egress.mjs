import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

// La optimización no debe introducir caché en ventas, caja ni inventario OPS.
const base=fs.readFileSync("src/application/loyverse/cached-catalog-base.ts","utf8");
const recipes=fs.readFileSync("src/application/loyverse/recipes.ts","utf8");
const catalog=fs.readFileSync("src/application/pos/catalog.ts","utf8");
const hub=fs.readFileSync("app/(employee)/pos/printer/hub-actions.ts","utf8");
const reconcileRoute=fs.readFileSync("app/api/internal/loyverse/reconcile/route.ts","utf8");
assert.match(reconcileRoute,/process\.env\.OPS_LEGACY_LOYVERSE_AUTOSYNC!=="true"/);
assert.ok(reconcileRoute.indexOf("if (!authorized(request))")<
  reconcileRoute.indexOf("OPS_LEGACY_LOYVERSE_AUTOSYNC"),
  "El endpoint cron debe seguir rechazando solicitudes sin autenticación");
assert.ok(reconcileRoute.indexOf("OPS_LEGACY_LOYVERSE_AUTOSYNC")<
  reconcileRoute.indexOf("processPendingLoyverseWebhooks()"),
  "El cron legacy se detiene antes de abrir la base o llamar a Loyverse");

assert.match(base,/unstable_cache/);
assert.match(base,/getCachedLoyverseCatalogBase=unstable_cache/);
assert.match(base,/getCachedLoyversePopularity/);
assert.match(base,/revalidate:LEGACY_LOYVERSE_CACHE_SECONDS/);
assert.match(base,/LEGACY_LOYVERSE_CACHE_SECONDS=12\*60\*60/);
assert.match(base,/ops_catalog_archive_snapshots/);
assert.doesNotMatch(base,/\.from\(loyverseItems\)/);
assert.doesNotMatch(base,/\.from\(loyverseVariants\)/);
assert.doesNotMatch(base,/\.from\(loyverseCategories\)/);
assert.match(recipes,/getCachedLoyverseCatalogBase\(organizationId\)/);
assert.doesNotMatch(recipes,/\.from\(loyverseItemSettings\)/,
  "La copia estática OPS incluye los costos antiguos sin lecturas repetidas");
assert.doesNotMatch(recipes,/\.from\(loyverseItems\)/);
assert.match(catalog,/getCachedLoyverseCatalogBase\(organizationId\)/);
assert.match(catalog,/getCachedLoyversePopularity\(organizationId\)/);
assert.match(catalog,/itemExternalId:row\.loyverseItemExternalId/,
  "Mantener enlace receta-producto / variante previa");
assert.match(catalog,/\.from\(posCatalogOverrides\)/,
  "Las actualizaciones de precio y receta OPS deben verse de inmediato");
assert.match(catalog,/\.from\(posManualProducts\)/,
  "Productos manuales OPS siempre en tiempo real");
assert.doesNotMatch(catalog,/\.from\(loyverseItems\)/);
assert.doesNotMatch(catalog,/\.from\(loyverseVariants\)/);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"epico-print-efficiency-"));
try{
  const source=fs.readFileSync("src/domain/pos/print-feed-window.ts","utf8");
  fs.writeFileSync(path.join(temp,"print-feed-window.cjs"),ts.transpileModule(source,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText);
  const {efficientPrintFeedSince,PRINT_FEED_WINDOW_MS,AUTO_PRINT_WINDOW_MS}=
    createRequire(path.join(temp,"run.cjs"))("./print-feed-window.cjs");
  const now=new Date("2026-10-13T20:00:00Z");
  const day=new Date("2026-10-12T20:00:00Z");
  const recent=new Date("2026-10-13T19:59:00Z");
  assert.equal(PRINT_FEED_WINDOW_MS,900000);
  assert.equal(AUTO_PRINT_WINDOW_MS,300000);
  assert.equal(efficientPrintFeedSince(day,now).toISOString(),"2026-10-13T19:45:00.000Z");
  assert.equal(efficientPrintFeedSince(recent,now).toISOString(),recent.toISOString());
  assert.match(hub,/efficientPrintFeedSince\(allowedSince\(since\)\)/);
  assert.match(hub,/MAX_AUTO_PRINT_AGE_MS=5\*60\*1000/,
    "Nunca imprimir trabajos mayores a cinco minutos automáticamente");
  assert.match(hub,/POS_PRINT_HUB_CLAIMED/);
  assert.match(hub,/POS_PRINT_HUB_DONE/);
  assert.match(hub,/if\(events\.some\(e=>e\.action==="POS_PRINT_HUB_CLAIMED"\)\)return false/,
    "No reclamar trabajos ambiguos dos veces");
  assert.match(hub,/eq\(posOrders\.mode,"LIVE"\)/);
  console.log("Supabase free-tier: PASS (legado cacheado, precios OPS en vivo, impresión <=15 min, sin duplicados)");
}finally{fs.rmSync(temp,{recursive:true,force:true});}

\n// Protege el hot path de autenticación frente a regresiones de egress.
for(const path of ["src/infrastructure/auth/current-employee.ts","components/app-nav.tsx","proxy.ts"]){
 const source=fs.readFileSync(path,"utf8");
 assert.match(source,/\.auth\.getClaims\(/,`${path}: verificar JWT firmado localmente`);
 assert.doesNotMatch(source,/\.auth\.getUser\(/,`${path}: no consultar Auth en cada refresco/poll`);
 assert.match(source,/claims\.role\s*!==\s*["']authenticated["']/,
   `${path}: se requiere rol authenticated`);
 assert.match(source,/typeof claims\.sub\s*!==\s*["']string["']/,
   `${path}: se requiere identidad válida`);
}
console.log("Auth egress: PASS (JWT ES256 local, protección de rutas y personal activa)");
