import assert from "node:assert/strict";
import fs from "node:fs";
const hub=fs.readFileSync("app/(employee)/pos/printer/hub-actions.ts","utf8");
const client=fs.readFileSync("app/(employee)/pos/printer/print-station.tsx","utf8");
const background=fs.readFileSync("components/print-station-background.tsx","utf8");
const print=fs.readFileSync("app/(employee)/pos/receipt/[id]/direct-print-button.tsx","utf8");
const kitchen=fs.readFileSync("app/(employee)/pos/orders/auto-kitchen-print.tsx","utf8");
assert.ok(hub.includes("eq(posOrders.mode,\"LIVE\")"));
assert.ok(hub.includes("POS_PRINT_HUB_CLAIMED"));
assert.ok(hub.includes("POS_PRINT_HUB_DONE"));
assert.ok(hub.includes("POS_PRINT_HUB_FAILED"));
assert.ok(hub.includes("pg_advisory_xact_lock"));
assert.ok(hub.includes('events.some(e=>e.action==="POS_PRINT_HUB_CLAIMED")'),
  "Nunca volver a reclamar automáticamente un trabajo de impresión incierto");
assert.ok(hub.includes("allowedSince(since)"));
assert.ok(client.includes("window.setInterval(()=>void tick(),4000)"));
assert.ok(client.includes("hiddenMode"));
assert.ok(hub.includes('eq(posLoyaltyEntries.entryType,"EARN")'));
assert.ok(hub.includes("receiptLoyaltyView("));
assert.ok(hub.includes("loyaltyFor(split.label)"));
assert.ok(hub.includes("loyaltyFor(null)"));
assert.ok(hub.includes("extraLabels(line.expectedConsumption"));
assert.ok(print.includes('drawPair(context, "Saldo puntos"'));
assert.ok(print.includes('"Puntos ganados"'));
assert.ok(print.includes('"Puntos canjeados"'));
assert.ok(!hub.includes("pointsEarned:null,pointsBalance:null"),"El ticket de servidor no puede omitir los puntos del cliente");
assert.ok(client.includes("ops-print-hub-config-changed"));
assert.ok(client.includes("claimPrintStationJob(job.key,state.stationId)"));
assert.ok(client.includes("finishPrintStationJob(job.key,state.stationId"));
assert.ok(client.includes("acknowledgeKitchenPrint"));
assert.ok(print.includes("export async function printReceiptWithBridge"));
assert.ok(kitchen.includes("cafe-epico-print-hub-pc-v1"));
console.log("Print Hub: worker station, locks, no backfill and no double local firing PASS");


assert.ok(hub.includes("POS_PRINT_HUB_EXPIRED"),"Las comandas antiguas requieren revisión manual");
assert.ok(hub.includes("MAX_AUTO_PRINT_AGE_MS=5*60*1000"),"Límite de antigüedad de 5 minutos");
assert.ok(hub.includes("initiatedAt")&&hub.includes("Date.now()-initiatedAt.getTime()"),
  "La vigencia se revisa dentro de la transacción antes del claim");
assert.ok(hub.includes("heartbeatPrintStation")&&hub.includes("getPrintStationHealth"),
  "El estado de la estación debe estar disponible al POS");
assert.ok(client.includes("printerBridgeReady()"),"Verificar impresora física");
assert.ok(client.includes("heartbeatPrintStation("),"La estación emite heartbeat");
assert.ok(client.includes("if(!healthy)"),"No reservar trabajo si el puente está desconectado");
const banner=fs.readFileSync("components/print-station-health-banner.tsx","utf8");
assert.ok(banner.includes("getPrintStationHealth"),"Alerta en dispositivos remotos");
assert.ok(banner.includes('role="alert"'),"Alerta accesible");


// La impresora no debe desaparecer del segundo plano por una sola caída
// de sesión o red durante la carga inicial de configuración.
assert.match(background,/const loadTemplate=async\(\)=>/);
assert.match(background,/const settings=await getPrintStationTemplate\(\)/);
assert.match(background,/retryTimer=window\.setTimeout/);
assert.match(background,/retryDelay=Math\.min\(retryDelay\*2,30000\)/);
assert.match(background,/window\.addEventListener\("online",retryOnWake\)/);
assert.match(background,/document\.addEventListener\("visibilitychange",retryOnVisible\)/);
assert.doesNotMatch(background,/\.catch\(\(\)=>\{if\(alive\)setEnabled\(false\)\}/,
  "Una falla temporal no debe deshabilitar la estación hasta reiniciar OPS");
assert.match(background,/return \(\)=>\{\s*alive=false;/,
  "La reconexión debe limpiarse al desmontar el worker");
assert.match(client,/claimPrintStationJob\(job\.key,state\.stationId\)/,
  "Conservar la deduplicación y el bloqueo de cada trabajo");
console.log("Print Hub: recuperación automática tras error de sesión, sin reimpresión duplicada PASS");
