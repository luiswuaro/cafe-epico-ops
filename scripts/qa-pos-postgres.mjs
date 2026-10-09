import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import postgres from "postgres";

const connection=process.env.QA_DATABASE_URL;
assert.ok(connection,"QA_DATABASE_URL is required. Never run against an unknown DB.");
const parsed=new URL(connection);
assert.equal(parsed.hostname,"127.0.0.1","Safety guard: localhost required.");
assert.equal(parsed.pathname,"/ops_qa","Safety guard: dedicated QA database required.");

const pg=postgres(connection,{max:3,prepare:false});
after(async()=>pg.end({timeout:3}));

// Transpile and execute the same pure function imported by the POS cancellation service.
function loadReversalPlan(){
  const filename="src/application/pos/reversal-plan.ts";
  const source=fs.readFileSync(filename,"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
  },fileName:filename}).outputText;
  const exports={};
  runInNewContext(js,{exports,Map,Number,Array,Math,Error});
  assert.equal(typeof exports.planInventoryReversals,"function");
  return exports.planInventoryReversals;
}
const planInventoryReversals=loadReversalPlan();

test("dos cuentas que comparten café generan una sola reversa por insumo",()=>{
  const movements=[
    {locationId:"barra",inventoryItemId:"cafe",quantityDelta:"-18.000"},
    {locationId:"barra",inventoryItemId:"cafe",quantityDelta:"-18.000"},
    {locationId:"barra",inventoryItemId:"vaso",quantityDelta:"-1.000"},
  ];
  const reversal=planInventoryReversals(movements);
  assert.equal(reversal.length,2);
  assert.equal(reversal.find(x=>x.inventoryItemId==="cafe").returned,36);
  assert.equal(reversal.find(x=>x.inventoryItemId==="vaso").returned,1);
  assert.throws(()=>planInventoryReversals([
    {locationId:"a",inventoryItemId:"b",quantityDelta:1}
  ]),/inválido/);
  assert.throws(()=>planInventoryReversals([
    {locationId:"a",inventoryItemId:"b",quantityDelta:"NaN"}
  ]),/inválido/);
});

test("PostgreSQL permite reversa consolidada, rechaza repetición",async()=>{
  await pg.unsafe("CREATE TABLE qa_inventory_movements (provider text NOT NULL, external_id text NOT NULL, location_id text NOT NULL, item_id text NOT NULL, delta numeric(18,3) NOT NULL, UNIQUE(provider,external_id,item_id,location_id))");
  await pg.unsafe("INSERT INTO qa_inventory_movements (provider,external_id,location_id,item_id,delta) VALUES ('OPS_POS','cuenta-1','barra','cafe',-18),('OPS_POS','cuenta-2','barra','cafe',-18)");
  const original=await pg.unsafe("SELECT location_id AS \"locationId\", item_id AS \"inventoryItemId\",delta AS \"quantityDelta\" FROM qa_inventory_movements WHERE provider='OPS_POS'");
  const reversals=planInventoryReversals(original);
  for(const movement of reversals)await pg.unsafe(
    "INSERT INTO qa_inventory_movements(provider,external_id,location_id,item_id,delta) VALUES('OPS_POS_CANCEL','ticket-1',$1,$2,$3)",
    [movement.locationId,movement.inventoryItemId,movement.returned]
  );
  const rows=await pg.unsafe("SELECT delta::numeric AS delta FROM qa_inventory_movements WHERE provider='OPS_POS_CANCEL'");
  assert.equal(rows.length,1);
  assert.equal(Number(rows[0].delta),36);
  await assert.rejects(pg.unsafe(
    "INSERT INTO qa_inventory_movements(provider,external_id,location_id,item_id,delta) VALUES('OPS_POS_CANCEL','ticket-1','barra','cafe',18)"
  ),error=>error.code==="23505");
});

test("dos dispositivos compitiendo por el mismo cobro generan un solo pago",async()=>{
  await pg.unsafe("CREATE TABLE qa_order (id text PRIMARY KEY,status text NOT NULL,total numeric(14,2) NOT NULL)");
  await pg.unsafe("CREATE TABLE qa_payment (id bigserial PRIMARY KEY,order_id text NOT NULL REFERENCES qa_order(id),amount numeric(14,2) NOT NULL)");
  await pg.unsafe("INSERT INTO qa_order(id,status,total) VALUES('mesa-1','SENT',60)");
  async function pay(){
    return pg.begin(async tx=>{
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('mesa-1'))");
      const [order]=await tx.unsafe("SELECT status,total FROM qa_order WHERE id='mesa-1' FOR UPDATE");
      if(order.status==="PAID")return false;
      assert.equal(order.status,"SENT");
      await tx.unsafe("UPDATE qa_order SET status='PAID' WHERE id='mesa-1'");
      await tx.unsafe("INSERT INTO qa_payment(order_id,amount) VALUES('mesa-1',$1)",[order.total]);
      return true;
    });
  }
  const results=await Promise.all([pay(),pay()]);
  assert.deepEqual(results.sort(),[false,true]);
  const payments=await pg.unsafe("SELECT amount FROM qa_payment WHERE order_id='mesa-1'");
  assert.equal(payments.length,1);
  assert.equal(Number(payments[0].amount),60);
});

test("cambiar el precio de catálogo conserva el snapshot del ticket",async()=>{
  await pg.unsafe("CREATE TABLE qa_catalog(id text PRIMARY KEY,price numeric(14,2) NOT NULL)");
  await pg.unsafe("CREATE TABLE qa_order_line(id text PRIMARY KEY,item_id text NOT NULL REFERENCES qa_catalog(id),quantity numeric(12,3) NOT NULL,unit_price numeric(14,2) NOT NULL)");
  await pg.unsafe("INSERT INTO qa_catalog(id,price) VALUES('americano',30)");
  await pg.unsafe("INSERT INTO qa_order_line(id,item_id,quantity,unit_price) VALUES('linea-1','americano',2,30)");
  await pg.unsafe("UPDATE qa_catalog SET price=35 WHERE id='americano'");
  const [snapshot]=await pg.unsafe("SELECT SUM(quantity*unit_price)::numeric AS original_total FROM qa_order_line");
  const [catalog]=await pg.unsafe("SELECT price FROM qa_catalog WHERE id='americano'");
  assert.equal(Number(snapshot.original_total),60);
  assert.equal(Number(catalog.price),35);
});
