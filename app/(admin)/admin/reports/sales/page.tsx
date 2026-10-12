import Link from "next/link";
import {parseSalesRange,getSalesPeriodReport} from "@/src/application/analytics/sales-report";
import {requirePermission} from "@/src/infrastructure/auth/permissions";

export const dynamic="force-dynamic";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
const pct=(value:number|null)=>value===null?"Sin base":(value>0?"+":"")+value.toFixed(1)+"%";

export default async function SalesReportPage({searchParams}:{
 searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
 const params=await searchParams;
 const {organizationId}=await requirePermission("admin.access");
 let range:ReturnType<typeof parseSalesRange>,badRange=false;
 try{range=parseSalesRange(params.from,params.to);}
 catch{range=parseSalesRange(undefined,undefined);badRange=true;}
 const data=await getSalesPeriodReport(organizationId,range);
 const rawFijos=typeof params.fijos==="string"?params.fijos:"";
 const monthlyFijos=rawFijos.trim()!==""&&Number.isFinite(Number(rawFijos))&&Number(rawFijos)>=0
   ?Number(rawFijos):null;
 const allocated=monthlyFijos===null?null:monthlyFijos*range.days/30;
 const simulated=data.metrics.grossBenefit!==null&&allocated!==null
   ?data.metrics.grossBenefit-allocated:null;
 const maxSales=Math.max(1,...data.days.map(d=>d.net));
 return <main className="shell">
   <section className="hero">
     <p className="eyebrow">CAFÉ ÉPICO · INTELIGENCIA COMERCIAL</p>
     <h1>Reporte de ventas OPS</h1>
     <p className="muted">Reporte por fecha de cobro · hora de Tepexi (America/Mexico_City).
       Sólo ventas OPS LIVE pagadas. Excluye pruebas, tickets abiertos y cancelaciones;
       no mezcla recibos históricos de Loyverse.</p>
     <Link className="button" href="/admin/analytics">← Dashboard general</Link>
   </section>
   <section className="card stack">
    <h2>Selecciona tu periodo</h2>
    <form method="get" className="stack">
      <div className="grid">
       <label>Desde <input type="date" name="from" defaultValue={range.from} required/></label>
       <label>Hasta <input type="date" name="to" defaultValue={range.to} required/></label>
       <label>Costos fijos mensuales para simulación (MXN · opcional)
        <input type="number" min={0} step="0.01" name="fijos" defaultValue={monthlyFijos??""} placeholder="No confirmados"/></label>
      </div>
      <button type="submit">Generar reporte</button>
    </form>
    {badRange&&<p className="status-warn">El periodo solicitado no era válido (máximo 366 días); se muestra hoy.</p>}
    <p className="muted">Ventas netas = brutas menos descuentos registrados, <strong>no significa ventas sin IVA</strong>.
      Los costos fijos son opcionales y no se descuentan de las ventas reales.</p>
   </section>
   <section className="grid" style={{marginTop:"1rem"}}>
    <article className="card"><p className="eyebrow">VENTAS BRUTAS</p>
      <div className="metric">{money.format(data.metrics.gross)}</div>
      <p>Antes de descuentos</p></article>
    <article className="card"><p className="eyebrow">VENTAS NETAS</p>
      <div className="metric">{money.format(data.metrics.net)}</div>
      <p>Periodo anterior {money.format(data.comparison.net)} · {pct(data.comparison.netChangePct)}</p></article>
    <article className="card"><p className="eyebrow">DESCUENTOS</p>
      <div className="metric">{money.format(data.metrics.discounts)}</div>
      <p>Descuentos de productos registrados</p></article>
    <article className="card"><p className="eyebrow">BENEFICIO BRUTO · CONTRIBUCIÓN</p>
      <div className="metric">{data.metrics.grossBenefit===null?"Pendiente":money.format(data.metrics.grossBenefit)}</div>
      <p>{data.metrics.marginPct===null?"Costos incompletos":pct(data.metrics.marginPct)+" sobre ventas netas"}</p>
    </article>
    <article className="card"><p className="eyebrow">OPERACIONES</p>
      <div className="metric">{data.tickets}</div>
      <p>Ticket promedio {money.format(data.avgTicket)} · {data.units} productos</p></article>
    <article className="card"><p className="eyebrow">COGS IDENTIFICADO</p>
      <div className="metric">{money.format(data.metrics.cogsKnown)}</div>
      <p>Órdenes con costo completo: {data.metrics.coverage.toFixed(0)}%.
        {data.metrics.cogsComplete?" Costo total disponible.":" Margen pendiente hasta completar recetas."}</p></article>
   </section>
   <section className="card stack" style={{marginTop:"1rem"}}>
     <h2>Auditoría de costos · inventario OPS</h2>
     <p className="muted">Los insumos se valoran según su unidad canónica (g, ml o pieza).
       Si el costo inicial fue importado después de una venta anterior, el
       importe se reconstruye con ese precio y <strong>no equivale a costo histórico confirmado</strong>.
       {data.reconstructedLines>0?" Líneas con valoración reconstruida: "+data.reconstructedLines+".":""}
     </p>
     {data.missingCosts.length===0?<p>Sin componentes pendientes de costo en el periodo.</p>:
      <div className="stack">{data.missingCosts.map(p=>
       <div className="task" key={p.reason}><span>{p.reason}</span>
        <strong>{p.usages} uso(s)</strong></div>)}</div>}
     <p className="muted"><strong>Hielo Hisense (estimación nominal):</strong> 300 W,
       18 kg/24 h, agua a $26/19 L y electricidad a $3/kWh. Costo calculado
       $2.5684/kg ($0.002568/g), sin inventariar existencias de hielo.
       No incluye mantenimiento, desgaste, filtración ni merma. El rendimiento
       eléctrico real debe medirse para confirmar el costo.</p>
     <p className="muted"><strong>Jarabe ICEE:</strong> precio informado $100/L.
       OPS maneja el insumo en gramos; la equivalencia provisional de 1.00 g/ml
       asigna $0.10/g hasta medir la densidad. Su contribución se identifica como estimada.</p>
   </section>
   <section className="card stack" style={{marginTop:"1rem"}}>
    <h2>¿Cuánto quedó de utilidad?</h2>
    <p>Beneficio bruto = venta neta − costo directo de insumos y empaques (COGS).
      La <strong>utilidad neta contable no puede calcularse todavía</strong> sin gastos efectivamente devengados,
      impuestos y comisiones de pago conciliados.</p>
    {monthlyFijos!==null&&<p>Simulación con costos fijos mensuales de {money.format(monthlyFijos)}:
      asignación de {range.days} día(s) / 30 = {money.format(allocated??0)}.
      Resultado operativo <strong>{simulated===null?"Pendiente de COGS":money.format(simulated)}</strong>
      {" "}(estimado, antes de impuestos y comisiones; no equivale a utilidad neta).</p>}
   </section>
   <section className="card" style={{marginTop:"1rem"}}>
    <h2>Ventas diarias · {range.from} a {range.to}</h2>
    <div className="stack">
     {data.days.map(day=><div key={day.date}>
       <div style={{display:"flex",justifyContent:"space-between",gap:"12px",flexWrap:"wrap"}}>
         <strong>{day.date}</strong>
         <span>{money.format(day.net)} · {day.tickets} tickets ·
          beneficio {day.grossBenefit===null?"pendiente":money.format(day.grossBenefit)}</span>
       </div>
       <div style={{background:"rgba(127,127,127,.12)",height:8,borderRadius:12,overflow:"hidden"}}>
        <div style={{width:((day.net/maxSales)*100)+"%",height:"100%",background:"currentColor",opacity:.6}}/>
       </div>
      </div>)}
    </div>
   </section>
   <section className="grid" style={{marginTop:"1rem"}}>
    <article className="card">
     <h2>Venta por categoría</h2>
     {data.categories.length===0?<p>Sin ventas en el periodo.</p>:data.categories.map(c=>
      <div className="task" key={c.name}><div>
       <strong>{c.name}</strong><p className="muted">{c.units} unidades · COGS {c.complete?money.format(c.cogs):"incompleto"}</p>
       </div><strong>{money.format(c.net)}</strong></div>)}
    </article>
    <article className="card">
     <h2>Métodos de pago</h2>
     {data.methods.length===0?<p>Sin movimientos cobrados.</p>:data.methods.map(m=>
      <div className="task" key={m.name}><strong>{m.name}</strong><span>{money.format(m.value)}</span></div>)}
     <p className="muted">Incluye canjes de puntos cuando forman parte del registro de pagos.</p>
    </article>
   </section>
   <section className="card" style={{marginTop:"1rem"}}>
    <h2>Venta por artículo</h2>
    <div style={{overflowX:"auto"}}><table style={{width:"100%"}}>
     <thead><tr><th style={{textAlign:"left"}}>Producto</th><th>Unidades</th>
      <th>Venta neta</th><th>Desc.</th><th>COGS</th><th>Beneficio bruto</th><th>Margen</th></tr></thead>
     <tbody>{data.products.map(p=><tr key={p.name}>
      <td>{p.name}</td><td style={{textAlign:"right"}}>{p.units}</td>
      <td style={{textAlign:"right"}}>{money.format(p.net)}</td>
      <td style={{textAlign:"right"}}>{money.format(p.discount)}</td>
      <td style={{textAlign:"right"}}>{p.complete?money.format(p.cogs):"Pendiente"}</td>
      <td style={{textAlign:"right"}}>{p.contribution===null?"—":money.format(p.contribution)}</td>
      <td style={{textAlign:"right"}}>{p.marginPct===null?"—":pct(p.marginPct)}</td>
     </tr>)}</tbody>
    </table></div>
   </section>
   <section className="card stack" style={{marginTop:"1rem"}}>
    <h2>Tendencias y oportunidades · datos reales</h2>
    <p className="muted">Se comparan unidades vendidas contra el periodo anterior de igual duración
      ({range.priorFrom} a {range.priorTo}). No es una predicción de demanda.</p>
    {data.trends.length===0?<p>Todavía no hay suficientes unidades para identificar tendencias.</p>:
     data.trends.map(p=><div className="task" key={p.name}>
      <div><strong>{p.name}</strong><div className="muted">{p.previous} → {p.units} unidades</div></div>
      <span className={p.deltaUnits<0?"status-warn":"status-ok"}>
       {p.changePct===null?"Producto sin ventas previas":pct(p.changePct)}
      </span></div>)}
    {data.metrics.coverage<100&&data.tickets>0&&<p className="status-warn">
      Prioridad financiera: completar los costos faltantes antes de comparar rentabilidad por producto.
    </p>}
   </section>
 </main>;
}
