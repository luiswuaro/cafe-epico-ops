/**
 * checkoutLiveOrder real contra PostgreSQL sintético EFÍMERO de GitHub Actions.
 * Únicamente se sustituye la lectura del catálogo por una receta controlada.
 * Nunca ejecutar contra la PC, Supabase cloud ni base comercial.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {createRequire} from "node:module";
import postgres from "postgres";
import ts from "typescript";
import {drizzle} from "drizzle-orm/postgres-js";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

function gate(){
 const e=process.env,u=new URL(e.DATABASE_URL??"");
 assert.ok(e.GITHUB_ACTIONS==="true"&&e.OPS_CI_DB_TEST==="true"&&
   e.POS_LIVE_ENABLED==="false"&&validateLocalQaConfig(e).ok&&
   u.hostname==="127.0.0.1"&&u.port==="5432"&&u.pathname==="/postgres"&&
   e.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa"&&
   e.DEFAULT_STORE_CODE==="QA-TEPEXI","Sólo PostgreSQL efímero CI");
}
const nodeRequire=createRequire(import.meta.url);
const cache=new Map();
function loadTs(file,overrides={}){
 const filename=resolve(file);
 if(cache.has(filename))return cache.get(filename).exports;
 const m={exports:{}};cache.set(filename,m);
 const js=ts.transpileModule(readFileSync(filename,"utf8"),{
  fileName:filename,compilerOptions:{
   module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
  },
 }).outputText;
 const importer=(name)=>{
  if(Object.hasOwn(overrides,name))return overrides[name];
  if(name.startsWith("@/"))return loadTs(name.slice(2)+".ts");
  if(name.startsWith("."))return loadTs(resolve(dirname(filename),name)+".ts");
  return nodeRequire(name);
 };
 new Function("require","module","exports",js)(importer,m,m.exports);
 return m.exports;
}
const equalMoney=(v,n,msg)=>assert.ok(Math.abs(Number(v)-n)<0.001,
 msg+": resultado="+String(v)+" esperado="+String(n));

async function main(){
 gate();
 const pg=postgres(process.env.DATABASE_URL,{max:5,prepare:false});
 const q=(statement,params=[])=>pg.unsafe(statement,params);
 try{
  const [org]=await q("select id from organizations where slug='cafe-epico-qa'");
  assert.ok(org?.id,"Organización QA faltante");
  const [store]=await q("select id from stores where organization_id=$1 and code='QA-TEPEXI'",[org.id]);
  assert.ok(store?.id,"Sucursal QA faltante");
  const [worker]=await q("insert into employees (organization_id,home_store_id,name) values ($1,$2,'QA CI CHECKOUT') returning id",[org.id,store.id]);
  let [location]=await q("select id from inventory_locations where organization_id=$1 and store_id=$2 and is_active=true limit 1",[org.id,store.id]);
  if(!location)[location]=await q("insert into inventory_locations (organization_id,store_id,name) values ($1,$2,'QA CI BARRA') returning id",[org.id,store.id]);
  const [item]=await q("insert into inventory_items (organization_id,name,sku,category,canonical_unit,tracking_type) values ($1,'QA CI CAFE','QA-CI-CHECKOUT-ITEM','CAFE','g','QUANTITY') returning id",[org.id]);
  await q("insert into inventory_balances (organization_id,store_id,location_id,inventory_item_id,theoretical_quantity) values ($1,$2,$3,$4,1000)",[org.id,store.id,location.id,item.id]);
  let [cash]=await q("select id from pos_cash_sessions where organization_id=$1 and store_id=$2 and status='OPEN' limit 1",[org.id,store.id]);
  if(!cash)[cash]=await q("insert into pos_cash_sessions (organization_id,store_id,status,opening_cash,opened_by_employee_id) values ($1,$2,'OPEN',500,$3) returning id",[org.id,store.id,worker.id]);
  assert.ok(cash?.id);
  const customers={};
  for(const [key,balance] of [["normal",0],["partial",30],["full",30],["race",0]]){
   const [row]=await q("insert into pos_customers (organization_id,name,points_balance) values ($1,$2,$3) returning id",[org.id,"QA CI "+key,balance]);
   customers[key]=row.id;
  }
  const product={
   id:"QA-CI-AMERICANO-30",name:"Americano QA CI",category:"CALIENTES",
   active:true,price:30,variantExternalId:null,
   serviceRecipes:{DINE_IN:{components:[{
    inventoryItemId:item.id,inventoryLocationId:location.id,
    costOnlyCode:null,variantExternalId:null,itemExternalId:null,
    name:"Cafe QA CI",quantity:18,unitLabel:"g",category:"CAFE",
   }]}}
  };
  const schema=loadTs("src/infrastructure/db/schema.ts");
  const orm=drizzle(pg,{schema});
  const overrides={
   "@/src/infrastructure/db/client":{getDb:()=>orm},
   "@/src/application/pos/catalog":{getPosCatalog:async()=>[product]},
   "@/src/application/pos/extra-catalog":{getPosExtraCatalog:async()=>[]},
  };
  const {checkoutLiveOrder}=loadTs("src/application/pos/live.ts",overrides);
  assert.equal(typeof checkoutLiveOrder,"function");
  const input=(key,method,points=0)=>({
   organizationId:org.id,storeId:store.id,employeeId:worker.id,
   actorUserId:null,clientOrderId:"qa-ci-live-"+key,
   cart:[{externalId:product.id,quantity:1,note:null,serviceMode:"DINE_IN"}],
   customerId:customers[key],serviceMode:"DINE_IN",
   paymentMethod:method,redeemPoints:points,tenderedAmount:method==="CASH"?100:null,
   tableLabel:"Mesa QA CI",note:null,
  });
  // Temporal sólo en ESTE proceso autorizado. La instancia de OPS queda apagada.
  process.env.POS_LIVE_ENABLED="true";
  const c1=input("normal","CARD"),normal=await checkoutLiveOrder(c1);
  assert.equal(normal.alreadyRecorded,false);
  const retry=await checkoutLiveOrder(c1);
  assert.equal(retry.alreadyRecorded,true);
  assert.equal(retry.id,normal.id);
  const partial=await checkoutLiveOrder(input("partial","CASH",10));
  const full=await checkoutLiveOrder(input("full","POINTS",30));
  const [raceA,raceB]=await Promise.all([
   checkoutLiveOrder(input("race","TRANSFER")),
   checkoutLiveOrder(input("race","TRANSFER")),
  ]);
  assert.equal(raceA.id,raceB.id);
  assert.equal([raceA,raceB].filter(r=>r.alreadyRecorded===false).length,1);
  const payments=await q("select order_id,method,amount from pos_payments where order_id=any($1::uuid[])",[pg.array([normal.id,partial.id,full.id,raceA.id])]);
  const lines=id=>payments.filter(p=>p.order_id===id).map(p=>[p.method,Number(p.amount)]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(lines(normal.id),[["CARD",30]]);
  assert.deepEqual(lines(partial.id),[["CASH",20],["POINTS",10]]);
  assert.deepEqual(lines(full.id),[["POINTS",30]]);
  assert.deepEqual(lines(raceA.id),[["TRANSFER",30]]);
  const ledger=await q("select order_id,entry_type,points from pos_loyalty_entries where order_id=any($1::uuid[])",[pg.array([normal.id,partial.id,full.id,raceA.id])]);
  const entries=id=>ledger.filter(x=>x.order_id===id).map(x=>[x.entry_type,Number(x.points)]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(entries(normal.id),[["EARN",1.5]]);
  assert.deepEqual(entries(partial.id),[["EARN",1],["REDEEM",-10]]);
  assert.deepEqual(entries(full.id),[["REDEEM",-30]]);
  assert.deepEqual(entries(raceA.id),[["EARN",1.5]]);
  for(const [key,expected] of [["normal",1.5],["partial",21],["full",0],["race",1.5]]){
   const [r]=await q("select points_balance from pos_customers where id=$1",[customers[key]]);
   equalMoney(r.points_balance,expected,"Saldo "+key);
  }
  const cashMoves=await q("select order_id,amount from pos_cash_movements where order_id=any($1::uuid[])",[pg.array([normal.id,partial.id,full.id,raceA.id])]);
  assert.equal(cashMoves.length,1);
  assert.equal(cashMoves[0].order_id,partial.id);
  equalMoney(cashMoves[0].amount,20,"Ingreso a caja");
  const inventoryMoves=await q("select source_id,quantity_delta from inventory_movements where source_type='POS_LIVE_ORDER' and source_id=any($1::text[])",[pg.array([normal.id,partial.id,full.id,raceA.id])]);
  assert.equal(inventoryMoves.length,4,"4 consumos únicos");
  inventoryMoves.forEach(m=>equalMoney(m.quantity_delta,-18,"Consumo por venta"));
  const [stock]=await q("select theoretical_quantity from inventory_balances where store_id=$1 and location_id=$2 and inventory_item_id=$3",[store.id,location.id,item.id]);
  equalMoney(stock.theoretical_quantity,928,"Stock final");
  const [audit]=await q("select count(*)::int as n from audit_events where action='POS_LIVE_SALE_PAID' and entity_id=any($1::text[])",[pg.array([normal.id,partial.id,full.id,raceA.id])]);
  assert.equal(audit.n,4,"Auditoría por cobro");
  console.log("PASS: checkoutLiveOrder real, tarjeta y +1.50 pts");
  console.log("PASS: canje parcial 10 pts, efectivo $20, +1.00 pts");
  console.log("PASS: canje total 30 pts, sin cobro ni puntos nuevos");
  console.log("PASS: reintento secuencial y concurrente sin duplicar");
  console.log("PASS: caja, inventario y auditoría coherentes; DB efímera CI");
 }finally{
  process.env.POS_LIVE_ENABLED="false";
  await pg.end({timeout:5});
 }
}
main().catch(e=>{
 console.error("FAIL: checkout CI: "+String(e?.message??e)
   .replace(/postgres(?:ql)?:\/\/[^\s]+/ig,"[DB]").slice(0,300));
 process.exitCode=1;
});
