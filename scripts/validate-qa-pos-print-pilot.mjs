/** Pruebas estáticas del piloto POS QA de una única comanda. No toca DB ni papel. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const guard=read("src/domain/pos/qa-pos-print-pilot.ts");
assert.ok(guard.includes("qaPosPrintPilotSessionPrefix"));
assert.ok(guard.includes("OPS_QA_POS_PRINT_PILOT_RUN_ID"));
assert.ok(guard.includes("/^R[0-9]{8}[A-Z0-9]{2}$/"));
assert.ok(guard.includes("qaPosPrintPilotSessionPrefix(env)!==null"));
const pos=read("app/(employee)/pos/actions.ts");
const hub=read("app/(employee)/pos/printer/hub-actions.ts");
const board=read("app/(employee)/pos/orders/page.tsx");
const toggle=read("scripts/local/toggle-qa-pos-print-pilot.mjs");
for(const rule of [
 'env.OPS_QA_POS_PRINT_PILOT==="true"',
 'env.OPS_LOCAL_FIRST==="true"',
 'env.OPS_QA_MODE==="true"',
 'env.POS_LIVE_ENABLED==="false"',
 'env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa"',
 'env.DEFAULT_STORE_CODE==="QA-TEPEXI"',
 '!env.VERCEL && !env.VERCEL_ENV',
])assert.ok(guard.includes(rule),"Falta protección QA: "+rule);
assert.ok(pos.includes('orderMode==="SHADOW"&&status==="SENT"&&'));
assert.ok(pos.includes('qaPosPrintPilotEnabled()&&qaPilotPrefix!==null'));
assert.ok(pos.includes("qaPilotPrefix=qaPosPrintPilotSessionPrefix()"));
const lock=pos.indexOf("if(qaPilotRequested||(orderMode");
const prior=pos.indexOf("if(qaPilotRequested){",lock);
const insert=pos.indexOf(".insert(posOrders)",prior);
assert.ok(lock>=0&&prior>lock&&insert>prior);
assert.ok(pos.slice(lock,prior).includes("pg_advisory_xact_lock"));
assert.ok(pos.slice(prior,insert).includes('like(posOrders.folio,qaPilotPrefix!+"%")'));
assert.ok(pos.slice(prior,insert).includes("if(!prior)qaPilotFolio=qaPilotPrefix!+"));
assert.ok(pos.includes("folio: qaPilotFolio??folio(now, clientOrderId)"));
assert.ok(pos.includes('paidAt: status === "PAID" ? now : null'));
assert.ok(pos.includes("inventoryEffectApplied: false"));
assert.ok(pos.includes("loyaltyEffectApplied: false"));
for(const rule of [
 "const qaPilot=qaPosPrintPilotEnabled()?sql",
 "o.mode='SHADOW' AND o.folio LIKE",
 'QA_POS_PILOT_PREFIX+"%"',
 "o.status='SENT' AND o.paid_at IS NULL",
 "o.inventory_effect_applied=false AND o.loyalty_effect_applied=false",
 'if(!qaPosPrintPilotEnabled())return or(live,fixture)',
 'like(posOrders.folio,QA_POS_PILOT_PREFIX+"%")',
 'eq(posOrders.status,"SENT"),isNull(posOrders.paidAt)',
 'eq(posOrders.inventoryEffectApplied,false)',
 'eq(posOrders.loyaltyEffectApplied,false)',
])assert.ok(hub.includes(rule),"Falta condición en cola: "+rule);
assert.equal(hub.split("and $"+ "{printable}").length-1,3);
assert.ok(board.includes('order.mode==="SHADOW"&&!agentOwnsQaPilot'));
assert.ok(toggle.includes('process.env.POS_LIVE_ENABLED!=="false"'));
assert.ok(toggle.includes('copyFile(file,backup)'));
assert.ok(toggle.includes('lines.push("OPS_QA_POS_PRINT_PILOT="+desired)'));
console.log("PASS: piloto QA exige opt-in y aislamiento local; LIVE comercial intacto.");
console.log("PASS: una sola comanda POS por sesion bajo lock; SHADOW sin cobro, puntos ni inventario.");
console.log("PASS: feed y claim equivalentes; navegador no duplica impresión.");
console.log("PASS: sin PostgreSQL, sin cambios de configuración y sin papel.");
