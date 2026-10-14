import Link from "next/link";
import {getNativeDecisionCenter} from "@/src/application/decision-center/native-read";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {resolveOperationalIncident} from "./actions";

export const dynamic="force-dynamic";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:2});
const numeric=new Intl.NumberFormat("es-MX",{maximumFractionDigits:1});
const change=(value:number|null)=>value===null?"sin periodo comparable":
  (value>0?"+":"")+value.toFixed(1)+"%";

export default async function DecisionCenterPage(){
  const {organizationId}=await requirePermission("admin.access");
  const data=await getNativeDecisionCenter(organizationId);
  const {today,week,month}=data;
  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">COO + CFO · CENTRO DE DECISIONES OPS</p>
      <h1>Qué necesita atención hoy</h1>
      <p className="muted">
        Fuente verificable: tickets OPS LIVE pagados, inventario OPS, costos
        nativos e incidencias. No incorpora ventas ni existencias Loyverse.
      </p>
      <p className="muted">Actualizado: {new Date(data.asOf).toLocaleString("es-MX",{
        timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short"})}</p>
    </section>
    <section className="grid">
      <article className="card">
        <p className="eyebrow">HOY</p>
        <div className="metric">{money.format(today.sales)}</div>
        <p>{today.tickets} tickets · ticket medio {money.format(today.avgTicket)}</p>
        <p className="muted">{today.cogsComplete?"COGS completo": "COGS parcialmente conocido"}
          {" · "}{today.costCoveragePct.toFixed(0)}% de tickets costados</p>
        {today.cogsComplete&&<p>Contribución: {money.format(today.contribution)}</p>}
      </article>
      <article className="card">
        <p className="eyebrow">7 DÍAS</p>
        <div className="metric">{money.format(week.sales)}</div>
        <p>{week.tickets} tickets · {change(week.salesChangePct)} vs siete días previos</p>
        <p className="muted">{week.cogsComplete?"Contribución "+money.format(week.contribution):
          "Margen pendiente de costos completos"}</p>
      </article>
      <article className="card">
        <p className="eyebrow">30 DÍAS</p>
        <div className="metric">{money.format(month.sales)}</div>
        <p>{month.tickets} tickets · {numeric.format(month.itemsPerTicket)} unidades/ticket</p>
        <p className={month.cogsComplete?"status-ok":"status-warn"}>
          {month.cogsComplete?"COGS completo":"COGS incompleto: "+
            month.costCoveragePct.toFixed(1)+"% de cobertura"}</p>
      </article>
      <article className="card">
        <p className="eyebrow">REABASTO OPS</p>
        <div className="metric">{data.purchases.suggested.length}</div>
        <p>requisiciones sugeridas</p>
        <p className="muted">{data.unsetMinimumCount} insumos sin mínimo ·
          {" "}{data.unpricedCount} sin costo registrado</p>
        <Link href="/admin/purchases">Configurar compras →</Link>
      </article>
      <article className="card">
        <p className="eyebrow">TUESTE · 30 DÍAS</p>
        <div className="metric">{data.batches30}</div>
        <p>Batches en OPS</p>
        <p className="muted">Merma media real: {data.roastLoss30===null?
          "pendiente":data.roastLoss30.toFixed(2)+"%"}</p>
        <Link href="/admin/roasting">Abrir tueste →</Link>
      </article>
      <article className="card">
        <p className="eyebrow">INCIDENCIAS ABIERTAS</p>
        <div className="metric">{data.events.length}</div>
        <p className="muted">Hasta 12 incidencias recientes sin resolver.</p>
        <Link href="/admin/operations/events">Registrar o revisar →</Link>
      </article>
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Acciones prioritarias</h2>
      <p className="muted">
        Ordenadas por impacto. Los presupuestos son parciales cuando faltan costos;
        las ventas excluyen tickets de prueba, anulaciones y comandas sin cobrar.
      </p>
      {data.decisions.length===0
        ?<p className="status-ok">Sin alertas calculables con los datos actuales.</p>
        :<div className="stack">
          {data.decisions.map((d,index)=><div className="task" key={d.area+index}>
            <div style={{flex:1}}>
              <span className="pill">{d.level==="ACTION"?"ATENCIÓN":d.level==="WATCH"?"REVISAR":"INFORMACIÓN"}</span>
              {" "}<strong>{d.title}</strong>
              <div className="muted">{d.area} · {d.detail}</div>
            </div>
            <Link href={d.href}>Revisar →</Link>
          </div>)}
        </div>}
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Ingeniería de menú · datos OPS</h2>
      <p className="muted">
        Popularidad y contribución de los últimos 30 días. Solo clasificamos
        productos con COGS completo; sin costo íntegro se indica pendiente,
        nunca un margen aparentemente rentable.
      </p>
      {data.products.length===0?<p className="muted">No hay ventas OPS pagadas en el periodo.</p>:
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%"}}>
            <thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos</th>
              <th>COGS</th><th>Contribución</th><th>Cuadrante</th></tr></thead>
            <tbody>{data.products.map(p=><tr key={p.name}>
              <td><strong>{p.name}</strong></td>
              <td>{numeric.format(p.qty)}</td>
              <td>{money.format(p.sales)}</td>
              <td>{p.cogsComplete?money.format(p.cogs):"Pendiente"}</td>
              <td>{p.cogsComplete?money.format(p.contribution):"No calculable"}</td>
              <td>{p.quadrant}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
    <section className="card" style={{marginTop:"1rem"}}>
      <h2>Incidencias operativas abiertas</h2>
      {data.events.length===0?<p className="status-ok">Sin incidencias pendientes.</p>:
        <div className="stack">{data.events.map(event=><div className="task" key={event.id}>
          <div style={{flex:1}}>
            <strong>{event.itemName??event.eventType}</strong>{" · "}
            <span className={event.severity==="CRITICAL"?"status-warn":"muted"}>{event.severity}</span>
            <div className="muted">{event.note??"Sin descripción adicional"}</div>
            <div className="muted">{event.occurredAt.toLocaleString("es-MX",{
              timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short"})}</div>
          </div>
          {(event.eventType==="BAR_INCIDENT"||event.eventType==="STOCK_COUNT")&&
            <form action={resolveOperationalIncident}>
              <input type="hidden" name="eventId" value={event.id}/>
              <button type="submit">Resolver</button>
            </form>}
        </div>)}</div>}
    </section>
    <p style={{marginTop:"1rem"}}><Link href="/admin">← Volver a administración</Link></p>
  </main>;
}
