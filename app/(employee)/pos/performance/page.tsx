import Link from "next/link";
import {and,desc,eq,gte,inArray} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,posOrders,posOrderLines} from "@/src/infrastructure/db/schema";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {deriveCommandTimeline,durationSeconds,durationText} from "@/src/domain/pos/command-timing";

export const dynamic="force-dynamic";

function average(values:number[]){
  return values.length?Math.round(values.reduce((sum,n)=>sum+n,0)/values.length):null;
}
function median(values:number[]){
  if(!values.length)return null;
  const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);
  return v.length%2?v[m]:Math.round((v[m-1]+v[m])/2);
}
const formatted=(seconds:number|null)=>seconds===null?"Sin muestras":durationText(seconds);
function reportClock(){return new Date();}

export default async function PosPerformance(){
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const db=getDb();
  const now=reportClock();
  const cutoff=new Date(now.getTime()-7*86400000);
  const orders=await db.select({
    id:posOrders.id,folio:posOrders.folio,mode:posOrders.mode,
    serviceMode:posOrders.serviceMode,tableLabel:posOrders.tableLabel,
    status:posOrders.status,createdAt:posOrders.createdAt,
    paidAt:posOrders.paidAt,total:posOrders.total,
  }).from(posOrders).where(and(
    eq(posOrders.organizationId,employee.organizationId),
    eq(posOrders.storeId,employee.homeStoreId),
    eq(posOrders.mode,"LIVE"),
    gte(posOrders.createdAt,cutoff),
    inArray(posOrders.status,["PAID","SENT","PREPARING","READY","PARTIALLY_PAID"]),
  )).orderBy(desc(posOrders.createdAt)).limit(150);
  const ids=orders.map(o=>o.id);
  const [lines,events]=ids.length?await Promise.all([
    db.select({orderId:posOrderLines.orderId,createdAt:posOrderLines.createdAt,
      expectedConsumption:posOrderLines.expectedConsumption})
      .from(posOrderLines).where(inArray(posOrderLines.orderId,ids)),
    db.select({entityId:auditEvents.entityId,action:auditEvents.action,
      createdAt:auditEvents.createdAt,afterData:auditEvents.afterData})
      .from(auditEvents).where(and(
        eq(auditEvents.organizationId,employee.organizationId),
        eq(auditEvents.entityType,"pos_order"),
        inArray(auditEvents.entityId,ids),
        inArray(auditEvents.action,["POS_COMMAND_PRINT_ACKNOWLEDGED","POS_COMMAND_STATUS_CHANGED","POS_TAKEAWAY_DISPATCHED"]),
      )),
  ]):[[],[]];
  const details=orders.map(order=>{
    const orderLines=lines.filter(line=>line.orderId===order.id)
      .sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
    const timing=deriveCommandTimeline(order.createdAt,orderLines,
      events.filter(event=>event.entityId===order.id));
    const printToReady=timing.printAckAt&&timing.readyAt &&
      timing.readyAt.getTime()>=timing.printAckAt.getTime()
      ?durationSeconds(timing.printAckAt,timing.readyAt):null;
    const prep=timing.preparingAt&&timing.readyAt &&
      timing.readyAt.getTime()>=timing.preparingAt.getTime()
      ?durationSeconds(timing.preparingAt,timing.readyAt):null;
    // Apertura de ticket -> cobro. No mide entrada/salida física del cliente.
    const tableSeconds=order.serviceMode==="DINE_IN"
      ?durationSeconds(order.createdAt,order.paidAt??now):null;
    const receivedToDispatch=orderLines.some(line=>line.expectedConsumption?.serviceMode==="TAKEAWAY")&&timing.dispatchedAt
      ?durationSeconds(order.createdAt,timing.dispatchedAt):null;
    const readyToDispatch=orderLines.some(line=>line.expectedConsumption?.serviceMode==="TAKEAWAY")&&timing.readyAt&&timing.dispatchedAt
      ?durationSeconds(timing.readyAt,timing.dispatchedAt):null;
    const hasTakeaway=orderLines.some(line=>line.expectedConsumption?.serviceMode==="TAKEAWAY");
    return {...order,...timing,hasTakeaway,printToReady,prep,tableSeconds,receivedToDispatch,readyToDispatch};
  });
  const valid=(values:(number|null)[])=>values.filter((n):n is number=>n!==null);
  const barValues=valid(details.map(d=>d.printToReady));
  const prepValues=valid(details.map(d=>d.prep));
  const paidTableValues=valid(details.filter(d=>d.paidAt!==null).map(d=>d.tableSeconds));
  const openTableCount=details.filter(d=>d.serviceMode==="DINE_IN"&&!d.paidAt).length;
  const takeaway=details.filter(d=>d.hasTakeaway);
  const dispatched=valid(takeaway.map(d=>d.receivedToDispatch));
  const handoff=valid(takeaway.map(d=>d.readyToDispatch));
  return <main className="shell pos-shell ops-performance">
    <header className="hero pos-hero">
      <div>
        <p className="eyebrow">INGENIERÍA DE OPERACIONES · ÚLTIMOS 7 DÍAS</p>
        <h1>Tiempos de servicio</h1>
        <p className="muted">Medición por ticket y ronda vigente. No se inventan tiempos de impresión o preparación que nunca se registraron.</p>
      </div>
      <div className="pos-result-actions">
        <Link className="button" href="/pos/orders">Comandas</Link>
        <Link className="button" href="/pos">POS</Link>
      </div>
    </header>
    <section className="ops-performance-kpis">
      <article className="card"><p className="eyebrow">Impresora → Lista</p>
        <strong className="metric">{formatted(average(barValues))}</strong>
        <small className="muted">{barValues.length} rondas con acuse y listo · mediana {formatted(median(barValues))}</small>
      </article>
      <article className="card"><p className="eyebrow">Preparando → Lista</p>
        <strong className="metric">{formatted(average(prepValues))}</strong>
        <small className="muted">{prepValues.length} rondas con ambos estados registrados</small>
      </article>
      <article className="card"><p className="eyebrow">Para llevar: pedido → entregado</p>
        <strong className="metric">{formatted(average(dispatched))}</strong>
        <small className="muted">{dispatched.length} pedidos entregados · mediana {formatted(median(dispatched))}</small>
      </article>
      <article className="card"><p className="eyebrow">Para llevar: listo → entregado</p>
        <strong className="metric">{formatted(average(handoff))}</strong>
        <small className="muted">{handoff.length} entregas medidas</small>
      </article>
      <article className="card"><p className="eyebrow">Mesa: apertura → cobro</p>
        <strong className="metric">{formatted(average(paidTableValues))}</strong>
        <small className="muted">{paidTableValues.length} mesas cobradas · {openTableCount} abiertas</small>
      </article>
    </section>
    <p className="muted ops-performance-method">
      La hora de impresión es el acuse <strong>OK del puente ESC/POS</strong>, no una prueba física del papel.
      La estancia de mesa empieza al abrir la cuenta y termina al cobrarla, no cuando sale el cliente.
      La muestra incluye hasta 150 tickets recientes; si falta un evento se muestra «—».
    </p>
    <div className="ops-performance-scroll">
      <table className="ops-performance-table">
        <thead><tr><th>Pedido</th><th>Servicio</th><th>Estado</th><th>Impresora → Lista</th>
          <th>Preparación</th><th>Pedido → entregado</th><th>Listo → entregado</th><th>Mesa abierta / duración</th><th>Acción</th></tr></thead>
        <tbody>{details.map(d=><tr key={d.id}>
          <td><strong>{d.tableLabel||d.folio}</strong><small>{d.createdAt.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}</small></td>
          <td>{d.serviceMode==="TAKEAWAY"?"Para llevar":d.hasTakeaway?"Mixto":"Aquí"}</td>
          <td>{d.status==="PAID"?"Cobrado":d.status==="READY"?"Listo":d.status==="PREPARING"?"Preparando":"Pendiente"}</td>
          <td>{d.printToReady!==null?durationText(d.printToReady):"—"}</td>
          <td>{d.prep!==null?durationText(d.prep):"—"}</td>
          <td>{d.receivedToDispatch===null?"—":durationText(d.receivedToDispatch)}</td>
          <td>{d.readyToDispatch===null?"—":durationText(d.readyToDispatch)}</td>
          <td>{d.tableSeconds===null?"—":durationText(d.tableSeconds)}{d.serviceMode==="DINE_IN"&&!d.paidAt?" · abierta":""}</td>
          <td><Link href={d.status==="PAID"?"/pos/receipt/"+d.id:"/pos/orders"}>Ver ticket</Link></td>
        </tr>)}</tbody>
      </table>
      {!details.length&&<p className="muted">Sin tickets LIVE en los últimos 7 días.</p>}
    </div>
  </main>;
}
