/**
 * Tests reales de restricciones PostgreSQL sobre el contenedor QA de CI.
 * Cada intento exitoso anterior al fallo se revierte al fallar la transacción.
 * No ejecutable contra un entorno de ventas real.
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

function assertSyntheticConfig(){
  if(process.env.GITHUB_ACTIONS!=="true"||process.env.OPS_CI_DB_TEST!=="true")
    throw Error("Pruebas sólo para contenedor PostgreSQL efímero CI.");
  const result=validateLocalQaConfig(process.env);
  if(!result.ok)throw Error("Contenedor QA no aislado.");
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
    throw Error("Conexión PostgreSQL CI inválida.");
}
async function expectRolledBack(db,run,label){
  let code="";
  try{await db.begin(run)}catch(e){code=e?.code??""}
  assert.equal(code,"23505",label+": se esperaba restricción única");
}
async function main(){
  assertSyntheticConfig();
  const db=postgres(process.env.DATABASE_URL,{prepare:false,max:1});
  try{
    const [org]=await db`select id from organizations where slug='cafe-epico-qa'`;
    const [store]=await db`select id from stores where code='QA-TEPEXI' and organization_id=${org.id}`;
    assert.ok(org?.id&&store?.id,"Organización/sucursal QA requerida");
    const key="ci-contract-idempotency";
    const [before]=await db`select count(*)::int as total from pos_orders where client_order_id=${key}`;
    assert.equal(before.total,0,"El contenedor QA debe estar limpio");
    await expectRolledBack(db,async tx=>{
      await tx`insert into pos_orders (
        organization_id,store_id,client_order_id,folio,mode,status,
        service_mode,business_date,subtotal,total
      ) values (
        ${org.id},${store.id},${key},'QA-CONTRACT-A','SHADOW','PAID',
        'TAKEAWAY','2026-10-17',0,0
      )`;
      await tx`insert into pos_orders (
        organization_id,store_id,client_order_id,folio,mode,status,
        service_mode,business_date,subtotal,total
      ) values (
        ${org.id},${store.id},${key},'QA-CONTRACT-B','SHADOW','PAID',
        'TAKEAWAY','2026-10-17',0,0
      )`;
    },"Pedido repetido");
    const [after]=await db`select count(*)::int as total from pos_orders where client_order_id=${key}`;
    assert.equal(after.total,0,"La transacción debe revertir la orden previa al error");
    console.log("PASS: identificador de pedido único y rollback atómico");

    const [openBefore]=await db`select count(*)::int as total from pos_cash_sessions
      where store_id=${store.id} and status='OPEN'`;
    assert.equal(openBefore.total,0,"No iniciar las pruebas con caja abierta");
    await expectRolledBack(db,async tx=>{
      await tx`insert into pos_cash_sessions (organization_id,store_id,opening_cash,status)
        values(${org.id},${store.id},0,'OPEN')`;
      await tx`insert into pos_cash_sessions (organization_id,store_id,opening_cash,status)
        values(${org.id},${store.id},0,'OPEN')`;
    },"Apertura de caja duplicada");
    const [openAfter]=await db`select count(*)::int as total from pos_cash_sessions
      where store_id=${store.id} and status='OPEN'`;
    assert.equal(openAfter.total,0,"La prueba no debe dejar caja abierta");
    console.log("PASS: caja única por sucursal y rollback");

    let fkCode="";
    try{
      await db`insert into pos_order_lines (
        organization_id,order_id,catalog_external_id,name_snapshot,
        category_snapshot,unit_price,quantity,line_total
      ) values (
        ${org.id},'00000000-0000-4000-8000-ffffffffffff',
        'qa-orphan','Producto ficticio','QA',0,1,0
      )`;
    }catch(e){fkCode=e?.code??""}
    assert.equal(fkCode,"23503","No insertar líneas sin pedido");
    console.log("PASS: integridad referencial de líneas de venta");

    const [orders]=await db`select count(*)::int as total from pos_orders`;
    const [boxes]=await db`select count(*)::int as total from pos_cash_sessions`;
    assert.equal(orders.total,0,"El test de restricciones no deja órdenes");
    assert.equal(boxes.total,0,"El test de restricciones no deja cajas");
    console.log("PASS: pruebas de base de datos sin residuos");
  }finally{await db.end({timeout:3})}
}
main().catch(error=>{
  const code=error?.code??"";
  console.error("ERROR: contratos PostgreSQL QA no verificados"+(code?" ("+code+")":""));
  process.exitCode=1;
});
