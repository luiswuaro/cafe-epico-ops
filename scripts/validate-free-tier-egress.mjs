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
const printStation=fs.readFileSync("app/(employee)/pos/printer/print-station.tsx","utf8");
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
  assert.match(hub,/getVerifiedHotPathUserId\(\)/,
    "Solo la sonda combina JWT firmado, empleado activo y autorización en un SQL");
  assert.match(hub,/const original=await principal\(\)/,
    "Ante error de SQL, la sonda vuelve a la autorización original");
  assert.match(hub,/if\(!deferPermissionCheck\)/,
    "Cobros, ACKs y operaciones de impresora conservan la validación explícita");
  assert.match(hub,/join public\.employee_roles er/);
  assert.match(hub,/join public\.role_permissions rp/);
  assert.match(hub,/join public\.permissions p/);
  assert.match(hub,/e\.is_active=true/);
  assert.match(hub,/p\.code='pos\.sell'/);
  assert.match(hub,/er\.store_id is null or er\.store_id=/);
  assert.match(hub,/if\(permissionGranted===false\)throw new Error\("Missing permission: pos\.sell"\)/,
    "Permiso revocado debe fallar cerrado, no cargar trabajos");
  assert.match(hub,/if\(permissionGranted===null\)await assertEmployeePermission/,
    "Si falla la sonda, validar permisos en DB antes del fallback completo");
  assert.match(hub,/if\(!deferPermissionCheck\)/,
    "La impresión manual, los acuses y heartbeat siempre verifican permisos");

  assert.match(hub,/MAX_AUTO_PRINT_AGE_MS=5\*60\*1000/,
    "Nunca imprimir trabajos mayores a cinco minutos automáticamente");
  // Al estar inactivo el POS, comprobar cambios sin cargar tickets completos.
  // La sonda debe observar todas las clases de trabajos automáticos.
  assert.match(hub,/lastVersion===version\)return \{jobs:\[\],version\}/);
  for(const watched of ["pos_orders","pos_order_lines","pos_order_splits","audit_events"]){
    assert.ok(hub.includes("public."+watched),
      "La sonda necesita observar "+watched+" para no omitir impresiones");
  }
  assert.match(printStation,/lastFeedVersion\.current=jobs\.length===0&&\!Array\.isArray\(feed\)\?feed\.version:null/,
    "Con trabajo pendiente, consultar toda la cola para permitir la recuperación");
  assert.match(printStation,/setInterval\(\(\)=>void tick\(\),4000\)/,
    "Mantener revisión cada 4 s para no atrasar las comandas");
  assert.match(hub,/legacyClient\?jobs\.slice\(0,30\):\{jobs:jobs\.slice\(0,30\),version\}/,
    "Mantener estaciones Windows ya abiertas con el formato anterior");
  assert.match(hub,/POS_PRINT_HUB_CLAIMED/);
  assert.match(hub,/POS_PRINT_HUB_DONE/);
  assert.match(hub,/if\(events\.some\(e=>e\.action==="POS_PRINT_HUB_CLAIMED"\)\)return false/,
    "No reclamar trabajos ambiguos dos veces");
  assert.match(hub,/eq\(posOrders\.mode,"LIVE"\)/);
  console.log("Supabase free-tier: PASS (legado cacheado, precios OPS en vivo, impresión <=15 min, sin duplicados)");
}finally{fs.rmSync(temp,{recursive:true,force:true});}

// Protege el hot path de autenticación frente a regresiones de egress.
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

// Evitar repetir 2-3 joins RBAC en el mismo render sin introducir una caché
// que mantenga visibles accesos revocados al personal.
const permissionsSource=fs.readFileSync("src/infrastructure/auth/permissions.ts","utf8");
const navSource=fs.readFileSync("components/app-nav.tsx","utf8");
const boardSource=fs.readFileSync("app/(employee)/pos/orders/page.tsx","utf8");
assert.match(permissionsSource,/export async function getEmployeePermissions\(/);
assert.match(permissionsSource,/eq\(employees\.isActive, true\)/,
  "La consulta RBAC debe negar accesos a empleados desactivados");
assert.match(permissionsSource,/inArray\(permissions\.code, \[\.\.\.permissionCodes\]\)/,
  "Obtener múltiples permisos desde la misma consulta parametrizada");
assert.match(permissionsSource,/isNull\(employeeRoles\.storeId\)/,
  "Los roles generales deben seguir funcionando");
assert.match(permissionsSource,/eq\(employeeRoles\.storeId, storeId\)/,
  "Los roles por sucursal deben seguir filtrados");
assert.doesNotMatch(permissionsSource,/unstable_cache|revalidateTag|setTimeout/,
  "Nunca cachear autorizaciones de empleados entre solicitudes");
assert.match(navSource,/getEmployeePermissions\(employee\.id,\[/);
assert.match(navSource,/grants\.has\("admin\.access"\)/);
assert.match(navSource,/grants\.has\("pos\.sell"\)/);
assert.match(navSource,/grants\.has\("pos\.cash\.manage"\)/);
assert.doesNotMatch(navSource,/employeeHasPermission\(/,
  "Navegación no debe repetir tres lecturas de permisos");
assert.match(boardSource,/getEmployeePermissions\(employee\.id,\[/);
assert.match(boardSource,/if\(!grants\.has\("pos\.sell"\)\)throw new Error/,
  "Negar acceso al tablero ANTES de leer comandas");
assert.ok(boardSource.indexOf('if(!grants.has("pos.sell"))')<
  boardSource.indexOf("getOpenPosOrders("),
  "Nunca consultar pedidos a quien no tenga pos.sell");
assert.match(boardSource,/const canCancel=grants\.has\("pos\.cancel"\)/,
  "La cancelación sigue oculta para quienes no tengan permiso");
assert.match(fs.readFileSync("app/(employee)/pos/orders/auto-refresh.tsx","utf8"),
  /setInterval\(refreshVisible,5000\)/,
  "No retrasar la actualización de comandas");
console.log("RBAC egress: PASS (permisos actuales agrupados, alcance sucursal y seguridad intactos)");

// El incidente del 12/10 nació de sondeos persistentes por pestaña y
// router.refresh() que descargaba el tablero completo cada cinco segundos.
const indicator=fs.readFileSync("components/print-job-indicator.tsx","utf8");
const boardProbe=fs.readFileSync("app/(employee)/pos/orders/version-actions.ts","utf8");
const boardPoll=fs.readFileSync("app/(employee)/pos/orders/auto-refresh.tsx","utf8");
assert.match(indicator,/settled=true/);
assert.match(indicator,/result==="UNCLAIMED"\|\|result==="CLAIMED"/);
assert.match(indicator,/window.clearInterval\(interval\)/,
  "Dejar de consultar cuando DONE, FAILED o EXPIRED");
assert.match(printStation,/navigator\.locks\.request\("cafe-epico-ops-print-feed"/,
  "No abrir dos sondeos simultáneos desde varias pestañas");
assert.match(printStation,/if\(!lock\|\|!alive\)return/,
  "Solo la pestaña que consiguió el bloqueo revisa Supabase");
assert.match(printStation,/Date\.now\(\)-last<3500/,
  "Respetar intervalo entre pestañas, no multiplicar consultas");
assert.match(printStation,/claimPrintStationJob\(job\.key,state\.stationId\)/,
  "La deduplicación transaccional sigue siendo la última barrera");
assert.match(boardProbe,/assertEmployeePermission\(employee\.id,"pos\.sell",employee\.homeStoreId\)/);
for(const table of ["pos_orders","pos_order_lines","audit_events","pos_order_splits","pos_payments","pos_customers","pos_cash_sessions","pos_catalog_overrides"]){
  assert.ok(boardProbe.includes("public."+table),
    "La firma debe observar "+table+" para detectar cambios operativos");
}
assert.match(boardPoll,/getCommandBoardVersion\(\)/);
assert.match(boardPoll,/lastVersion!==version/);
assert.match(boardPoll,/lastFullRefresh>=60000/,
  "Recuperación de cambios no cubiertos por la firma en 60 s");
assert.match(boardPoll,/setInterval\(refreshVisible,5000\)/,
  "No demorar la visibilidad de nuevas comandas");
assert.match(boardPoll,/catch\{/);
assert.match(boardPoll,/router\.refresh\(\)/,
  "Si falla la sonda, refrescar la lista en vez de ocultarla");
console.log("Incidente 12/oct: PASS (estado terminal, pestaña única y feed del tablero seguro)");




// No volver a duplicar el viaje a la BD de identidad + permiso en
// las dos sondas permanentes. La vía original se conserva solo como
// fallback seguro (bootstrap/error SQL); nunca cachear RBAC entre polls.
const hotJwt=fs.readFileSync("src/infrastructure/auth/verified-hot-path-user.ts","utf8");
const newPrinterProbe=fs.readFileSync("app/(employee)/pos/printer/hub-actions.ts","utf8");
const newBoardProbe=fs.readFileSync("app/(employee)/pos/orders/version-actions.ts","utf8");
assert.match(hotJwt,/\.auth\.getClaims\(\)/);
assert.match(hotJwt,/claims\.role\s*!==\s*"authenticated"/);
assert.match(hotJwt,/typeof claims\.sub\s*!==\s*"string"/);
assert.doesNotMatch(hotJwt,/\.auth\.getUser\(|user_metadata|unstable_cache/);
for(const [name,source] of [["Impresión",newPrinterProbe],["Comandas",newBoardProbe]]){
  assert.match(source,/getVerifiedHotPathUserId\(\)/,
    name+": verificar JWT ES256 antes de la consulta SQL");
  assert.match(source,/e\.user_id=\$\{userId\}::uuid/,
    name+": nunca resolver otro empleado ni confiar en datos del navegador");
  assert.match(source,/org\.slug=\$\{organizationSlug\}/,
    name+": exigir organización activa correcta");
  assert.match(source,/e\.is_active=true/,
    name+": verificar revocación de empleado en CADA lectura");
  assert.match(source,/p\.code='pos\.sell'/,
    name+": comprobar acceso a venta en CADA lectura");
  assert.match(source,/er\.store_id is null or er\.store_id=s\.home_store_id/,
    name+": mantener alcance de permisos global o por sucursal");
  assert.match(source,/getCurrentEmployee\(\)/,
    name+": fallback a vinculación original y validación de empleado");
  assert.match(source,/assertEmployeePermission\(employee\.id,"pos\.sell",employee\.homeStoreId\)|if\(permissionGranted===null\)await assertEmployeePermission/,
    name+": fallo de SQL no debe omitir RBAC");
}
assert.match(newPrinterProbe,/case when access\.allowed and access\.home_store_id is not null then/);
assert.match(newPrinterProbe,/if\(permissionGranted===false\)throw new Error\("Missing permission: pos\.sell"\)/);
assert.match(newPrinterProbe,/const original=await principal\(\)/,
  "Fallos de la sonda deben invocar ruta anterior antes de leer tickets");
assert.match(newBoardProbe,/case when staff_access\.allowed and staff_access\.home_store_id is not null/);
assert.match(newBoardProbe,/if\(!candidate\.allowed\)throw new Error\("Missing permission: pos\.sell"\)/);
assert.match(newBoardProbe,/from access staff_access/,
  "Alias de acceso no puede confundirse con audit_events a");
assert.doesNotMatch(newBoardProbe,/from access a\b/,
  "Evitamos en SQL la sombra del alias audit_events a");
assert.match(newBoardProbe,/catch\(error\)/);
console.log("Hot path egress: PASS (JWT, empleado activo, organización, permisos, fallback)");
