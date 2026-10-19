/** Reconciliación de cobros LIVE sólo PostgreSQL temporal de GitHub CI.
 * Exclusivamente SELECT read-only; nunca se conecta al POS comercial.
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
function gate(){
 const e=process.env,u=new URL(e.DATABASE_URL??"");
 assert.ok(e.GITHUB_ACTIONS==="true"&&e.OPS_CI_DB_TEST==="true"&&
  e.OPS_QA_MODE==="true"&&e.POS_LIVE_ENABLED==="false"&&
  validateLocalQaConfig(e).ok&&u.hostname==="127.0.0.1"&&
  u.port==="5432"&&u.pathname==="/postgres","Sólo PostgreSQL efímero CI");
}
const near=(a,b)=>Math.abs(Number(a)-Number(b))<0.005;
gate();
const pg=postgres(process.env.DATABASE_URL,{max:1,prepare:false});
try{
 await pg.begin(async tx=>{
  await tx.unsafe("SET TRANSACTION READ ONLY");
  const orders=await tx.unsafe(
   "select o.id,o.folio,o.total,o.status, "+
   "coalesce(sum(p.amount),0) as paid, "+
   "coalesce(sum(p.amount) filter(where p.method='POINTS'),0) as points, "+
   "coalesce(sum(p.amount) filter(where p.method='CASH'),0) as cash, "+
   "coalesce(sum(p.amount) filter(where p.method in ('CARD','TRANSFER')),0) as electronic "+
   "from public.pos_orders o left join public.pos_payments p on p.order_id=o.id "+
   "join public.organizations g on g.id=o.organization_id "+
   "where g.slug='cafe-epico-qa' and o.mode='LIVE' "+
   "group by o.id,o.folio,o.total,o.status");
  assert.equal(orders.length,4,"Se requieren cuatro ventas LIVE sintéticas");
  let total=0,points=0,cash=0,electronic=0;
  for(const row of orders){
   assert.equal(row.status,"PAID","Venta incompleta: "+row.folio);
   assert.ok(near(row.total,row.paid),"Pagos no concilian: "+row.folio);
   total+=Number(row.total);points+=Number(row.points);
   cash+=Number(row.cash);electronic+=Number(row.electronic);
  }
  assert.ok(near(total,120)&&near(points,40)&&near(cash,20)&&near(electronic,60),
   "Total por modalidad no coincide");
  const cashLines=await tx.unsafe(
   "select m.order_id,m.amount "+
   "from public.pos_cash_movements m "+
   "join public.pos_orders o on o.id=m.order_id "+
   "join public.organizations g on g.id=o.organization_id "+
   "where g.slug='cafe-epico-qa' and o.mode='LIVE' and m.movement_type='SALE'");
  assert.equal(cashLines.length,1,"Una entrada de efectivo");
  assert.ok(near(cashLines[0].amount,cash),"Caja y pagos CASH no concilian");
  const [pointsLedger]=await tx.unsafe(
   "select count(*)::int as n,coalesce(sum(l.points),0) as net "+
   "from public.pos_loyalty_entries l "+
   "join public.pos_orders o on o.id=l.order_id "+
   "join public.organizations g on g.id=o.organization_id "+
   "where g.slug='cafe-epico-qa' and o.mode='LIVE'");
  assert.equal(pointsLedger.n,5,"Acumulación + canjes esperados");
  assert.ok(near(pointsLedger.net,-36),"Libro de puntos no concilia");
  console.log("PASS: 4 ventas $120 = $40 puntos + $20 efectivo + $60 electrónicos.");
  console.log("PASS: caja $20 y lealtad 5 movimientos, neto -36 puntos.");
  console.log("PASS: auditoría SQL read-only en PostgreSQL efímero de CI.");
 });
}finally{await pg.end({timeout:3})}
