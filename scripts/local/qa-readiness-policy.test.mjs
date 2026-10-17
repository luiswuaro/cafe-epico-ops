import assert from "node:assert/strict";
import {test} from "node:test";
import {assessQaSnapshot,CRITICAL_QA_TABLES} from "./qa-readiness-policy.mjs";
const demo=()=>({
 presentTables:[...CRITICAL_QA_TABLES],
 expectedMigrations:[{name:"0000_core.sql",sha256:"a"}],
 appliedMigrations:[{name:"0000_core.sql",sha256:"a"}],
 organizations:[{id:"org-qa",slug:"cafe-epico-qa"}],
 stores:[{code:"QA-TEPEXI",organizationId:"org-qa"}],
 authUsers:0,orders:0,liveOrders:0,
});
test("acepta base QA con migraciones íntegras; avisa que falta Auth",()=>{
 const result=assessQaSnapshot(demo());
 assert.equal(result.ok,true);
 assert.ok(result.warnings.some(x=>x.includes("Auth")));
});
test("rechaza falta de POS y tablas financieras",()=>{
 const x=demo();x.presentTables=x.presentTables.filter(n=>n!=="public.pos_orders");
 assert.equal(assessQaSnapshot(x).ok,false);
});
test("rechaza hashes SQL que cambian después de aplicar",()=>{
 const x=demo();x.appliedMigrations[0].sha256="otro";
 assert.equal(assessQaSnapshot(x).ok,false);
});
test("rechaza organización de producción y sucursal errónea",()=>{
 for(const change of [
 x=>x.organizations=[{id:"prod",slug:"cafe-epico"}],
 x=>x.stores[0].code="TEPEXI",
 x=>x.organizations.push({id:"prod",slug:"cafe-epico"}),
 ]){const x=demo();change(x);assert.equal(assessQaSnapshot(x).ok,false)}
});
test("rechaza ventas LIVE, reporta pedidos ficticios",()=>{
 const x=demo();x.liveOrders=1;
 assert.equal(assessQaSnapshot(x).ok,false);
 x.liveOrders=0;x.orders=3;
 const result=assessQaSnapshot(x);
 assert.equal(result.ok,true);assert.ok(result.warnings.some(s=>s.includes("3")));
});
