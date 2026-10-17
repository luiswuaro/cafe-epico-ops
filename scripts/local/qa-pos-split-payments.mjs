/**
 * Contratos con Postgres 17 real; únicamente CI efímero QA.
 * Dos clientes y dos cuentas: canje + transferencia; segunda con efectivo.
 * La misma restricción de producción rechaza cobrar dos veces una cuenta.
 * Todo se revierte: nunca deja pedidos, saldos o puntos persistentes.
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";
import {drizzle} from "drizzle-orm/postgres-js";
import {pgTable,uuid,text as pgText,jsonb,numeric} from "drizzle-orm/pg-core";
const nodeRequire=createRequire(import.meta.url);

function actualCustomerProfileReader(connection){
  const schema={
    posCustomers:pgTable("pos_customers",{
      id:uuid("id"),organizationId:uuid("organization_id"),
      sourceExternalId:pgText("source_external_id"),
      name:pgText("name"),pointsBalance:numeric("points_balance"),
    }),
    loyverseCustomers:pgTable("loyverse_customers",{
      organizationId:uuid("organization_id"),
      externalId:pgText("external_id"),payload:jsonb("payload"),
    }),
  };
  const filename="src/application/pos/customer-purchases.ts";
  const typescript=readFileSync(filename,"utf8");
  const compiled=ts.transpileModule(typescript,{fileName:filename,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  runInNewContext(compiled,{exports,console,require(name){
    if(name==="drizzle-orm")return nodeRequire("drizzle-orm");
    if(name==="@/src/infrastructure/db/client")
      return {getDb:()=>drizzle(connection)};
    if(name==="@/src/infrastructure/db/schema")return schema;
    throw Error("Import no permitido en prueba perfil QA.");
  }});
  assert.equal(typeof exports.getCustomerPurchaseProfile,"function");
  return exports.getCustomerPurchaseProfile;
}

import {validateLocalQaConfig} from "./guard-qa-config.mjs";

function gate(){
  const env=process.env;
  if(env.GITHUB_ACTIONS!=="true"||env.OPS_CI_DB_TEST!=="true"||
     !validateLocalQaConfig(env).ok)
    throw Error("Este contrato sólo se ejecuta en PostgreSQL sintético CI.");
  const uri=new URL(env.DATABASE_URL??"");
  if(uri.hostname!=="127.0.0.1"||uri.pathname!=="/postgres")
    throw Error("Prohibido consultar una base comercial.");
}

async function main(){
 gate();
 const db=postgres(process.env.DATABASE_URL,{prepare:false,max:2});
 const rollbackTag="EXPECTED_QA_SPLIT_ROLLBACK";
 try{
   const [org]=await db`select id from public.organizations where slug='cafe-epico-qa'`;
   const [store]=await db`select id from public.stores
     where organization_id=${org.id} and code='QA-TEPEXI'`;
   assert.ok(org?.id&&store?.id);
   try{
     await db.begin(async tx=>{
       const [alice,bob]=await tx`insert into public.pos_customers
         (organization_id,name,points_balance)
         values (${org.id},'QA-Cuenta-A',22.50),
                (${org.id},'QA-Cuenta-B',0)
         returning id,points_balance`;
       const [order]=await tx`insert into public.pos_orders
         (organization_id,store_id,client_order_id,folio,mode,status,
          service_mode,business_date,subtotal,total,customer_id)
         values (${org.id},${store.id},'qa-contract-split',
           'QA-SPLIT-TEST','LIVE','SENT','DINE_IN',
           '2026-10-17',130,130,null) returning id`;
       const line1=await tx`insert into public.pos_order_lines
         (organization_id,order_id,catalog_external_id,name_snapshot,
          category_snapshot,unit_price,quantity,line_total)
         values (${org.id},${order.id},'qa-espresso','Latte español QA',
          'CALIENTES',70,1,70) returning id`;
       const line2=await tx`insert into public.pos_order_lines
         (organization_id,order_id,catalog_external_id,name_snapshot,
          category_snapshot,unit_price,quantity,line_total)
         values (${org.id},${order.id},'qa-matcha','Matcha QA',
          'FRÍAS',60,1,60) returning id`;
       const [splitA,splitB]=await tx`insert into public.pos_order_splits
         (organization_id,order_id,label,total,status)
         values (${org.id},${order.id},'Cuenta 1',70,'OPEN'),
                (${org.id},${order.id},'Cuenta 2',60,'OPEN')
         returning id,total`;
       await tx`insert into public.pos_order_split_lines
         (organization_id,split_id,order_line_id,quantity,line_total)
         values (${org.id},${splitA.id},${line1[0].id},1,70),
                (${org.id},${splitB.id},${line2[0].id},1,60)`;
       // Cuenta A: canje de 20 puntos + transferencia de 50 pesos.
       await tx`insert into public.pos_payments
         (organization_id,order_id,split_id,method,amount)
         values (${org.id},${order.id},${splitA.id},'POINTS',20),
                (${org.id},${order.id},${splitA.id},'TRANSFER',50)`;
       // Cuenta B: efectivo de $60; cliente distinto para recibir sus puntos.
       await tx`insert into public.pos_payments
         (organization_id,order_id,split_id,method,amount)
         values (${org.id},${order.id},${splitB.id},'CASH',60)`;
       const [session]=await tx`insert into public.pos_cash_sessions
         (organization_id,store_id,status,opening_cash)
         values (${org.id},${store.id},'OPEN',100) returning id`;
       await tx`insert into public.pos_cash_movements
         (organization_id,store_id,session_id,order_id,split_id,
          movement_type,amount)
         values (${org.id},${store.id},${session.id},${order.id},
          ${splitB.id},'SALE',60)`;
       // Exactamente la política actual: ganar 5 % sólo de dinero real.
       await tx`update public.pos_customers
         set points_balance=points_balance-20+2.5 where id=${alice.id}`;
       await tx`update public.pos_customers
         set points_balance=points_balance+3 where id=${bob.id}`;
       await tx`insert into public.pos_loyalty_entries
         (organization_id,customer_id,order_id,entry_type,points,note)
         values (${org.id},${alice.id},${order.id},'REDEEM',-20,'Cuenta 1 QA'),
                (${org.id},${alice.id},${order.id},'EARN',2.5,'Cuenta 1 QA'),
                (${org.id},${bob.id},${order.id},'EARN',3,'Cuenta 2 QA')`;
       await tx`update public.pos_order_splits
         set status='PAID',customer_id=${alice.id},paid_at=now()
         where id=${splitA.id}`;
       await tx`update public.pos_order_splits
         set status='PAID',customer_id=${bob.id},paid_at=now()
         where id=${splitB.id}`;
       await tx`update public.pos_orders
         set status='PAID',paid_at=now() where id=${order.id}`;
       const checks=await tx`
         select s.label,s.total,
           coalesce(sum(p.amount),0) as paid,
           count(p.id)::int as payment_count
         from public.pos_order_splits s
         join public.pos_payments p on p.split_id=s.id
         where s.order_id=${order.id}
         group by s.id,s.label,s.total
         order by s.label`;
       assert.deepEqual(checks.map(x=>[x.label,Number(x.total),Number(x.paid),x.payment_count]),
         [["Cuenta 1",70,70,2],["Cuenta 2",60,60,1]]);
       const [cash]=await tx`select sum(amount)::numeric as amount from
         public.pos_cash_movements where order_id=${order.id}`;
       assert.equal(Number(cash.amount),60);
       const customers=await tx`select id,points_balance from public.pos_customers
         where id in (${alice.id},${bob.id})`;
       assert.equal(Number(customers.find(c=>c.id===alice.id).points_balance),5);
       assert.equal(Number(customers.find(c=>c.id===bob.id).points_balance),3);
       const [points]=await tx`select count(*)::int as n,sum(points)::numeric as delta
         from public.pos_loyalty_entries where order_id=${order.id}`;
       assert.equal(points.n,3);assert.equal(Number(points.delta),-14.5);
       // Un cliente puede tener solamente su cuenta, NO toda la mesa.
       const profile=await tx`
         select s.customer_id as customer_id,
           sum(s.total)::numeric as subtotal,
           array_agg(l.name_snapshot order by l.name_snapshot) as products
         from public.pos_order_splits s
         join public.pos_order_split_lines sl on sl.split_id=s.id
         join public.pos_order_lines l on l.id=sl.order_line_id
         where s.order_id=${order.id} and s.status='PAID'
         group by s.customer_id order by s.customer_id`;
       assert.equal(profile.length,2);
       const a=profile.find(row=>row.customer_id===alice.id);
       const b=profile.find(row=>row.customer_id===bob.id);
       assert.equal(Number(a.subtotal),70);
       assert.deepEqual(a.products,["Latte español QA"]);
       assert.equal(Number(b.subtotal),60);
       assert.deepEqual(b.products,["Matcha QA"]);
       const [unassigned]=await tx`select count(*)::int as n
         from public.pos_order_splits where order_id=${order.id}
         and customer_id is null`;
       assert.equal(unassigned.n,0);
       // Ejecutar la función real del perfil (SQL y favoritos reales),
       // no una consulta inventada para la prueba.
       const getProfile=actualCustomerProfileReader(tx);
       const aProfile=await getProfile({
         organizationId:org.id,storeId:store.id,customerId:alice.id,page:1,
       });
       const bProfile=await getProfile({
         organizationId:org.id,storeId:store.id,customerId:bob.id,page:1,
       });
       assert.equal(aProfile.summary.tickets,1);
       assert.equal(aProfile.summary.spent,70);
       assert.equal(aProfile.history[0].split_id,splitA.id);
       assert.equal(aProfile.history[0].order_id,order.id);
       assert.deepEqual(aProfile.history[0].lines.map(l=>l.item_name),
         ["Latte español QA"]);
       assert.equal(aProfile.favoriteBeverages[0].name,"LATTE ESPAÑOL QA");
       assert.equal(bProfile.summary.tickets,1);
       assert.equal(bProfile.summary.spent,60);
       assert.equal(bProfile.history[0].split_id,splitB.id);
       assert.deepEqual(bProfile.history[0].lines.map(l=>l.item_name),
         ["Matcha QA"]);
       assert.equal(bProfile.favoriteBeverages[0].name,"MATCHA QA");
       console.log("PASS: perfil SQL REAL individual, importes y bebidas por cuenta.");
       // Duplicados se ignoran por índices ÚNICOS reales, no por la UI.
       const duplicateMoney=await tx`insert into public.pos_payments
         (organization_id,order_id,split_id,method,amount)
         values (${org.id},${order.id},${splitA.id},'CARD',50)
         on conflict do nothing returning id`;
       const duplicatePoints=await tx`insert into public.pos_payments
         (organization_id,order_id,split_id,method,amount)
         values (${org.id},${order.id},${splitA.id},'POINTS',20)
         on conflict do nothing returning id`;
       assert.equal(duplicateMoney.length,0,"Bloquear doble pago monetario");
       assert.equal(duplicatePoints.length,0,"Bloquear doble canje");
       const [total]=await tx`select coalesce(sum(amount),0) as amount
         from public.pos_payments where order_id=${order.id}`;
       assert.equal(Number(total.amount),130,"No duplicar ingresos");
       console.log("PASS: dos clientes, dos cuentas, $20 pts + $50 transferencia + $60 efectivo.");
       console.log("PASS: puntos finales 5 y 3, pagos $130, efectivo $60, sin duplicaciones.");
       throw Error(rollbackTag);
     });
     throw Error("Rollback QA no ejecutado");
   }catch(error){
     if(error?.message!==rollbackTag)throw error;
   }
   const [leftovers]=await db`select count(*)::int as n from public.pos_orders
     where client_order_id='qa-contract-split'`;
   assert.equal(leftovers.n,0);
   console.log("PASS: pruebas reversibles sin ventas ni puntos residuales.");
 }finally{await db.end({timeout:3});}
}
main().catch(error=>{
 const type=typeof error?.name==="string"?error.name.slice(0,40):"unknown";
 const reason=String(error?.message??"Sin detalle")
   .replace(/postgres(?:ql)?:\/\/[^\s]+/ig,"[DB]")
   .replace(/[\r\n]+/g," ").slice(0,220);
 console.error("BLOQUEADO: contrato QA "+type+" ("+(error?.code||"-")+"): "+reason);
 process.exitCode=1;
});
