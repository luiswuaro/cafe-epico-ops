"use client";

import { useEffect, useMemo, useState } from "react";
import type { getFinancialPreview } from "@/src/application/finance/preview";

type Data = Awaited<ReturnType<typeof getFinancialPreview>>;
const money = new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",maximumFractionDigits:2});
const number = (x:number) => Number.isFinite(x) ? x : 0;
const round = (x:number) => Math.round(x*100)/100;
const defaultFixed = [
  {key:"nomina",name:"Nómina estructural",amount:8000},
  {key:"renta",name:"Renta del local",amount:4000},
  {key:"electricidad",name:"Electricidad",amount:700},
  {key:"internet",name:"Internet",amount:500},
  {key:"contadora",name:"Contadora",amount:1000},
  {key:"mantenimiento",name:"Mantenimiento y reparaciones",amount:0},
  {key:"otros",name:"Otros gastos corrientes",amount:0},
];
const monthDays = (period: string) => {
  const [y,m]=period.split("-").map(Number);
  return new Date(y,m,0).getDate();
};
type Mode = "DINE_IN"|"TAKEAWAY"|"THERMOS";
type Promo = "NONE"|"THERMOS_10"|"STAFF_10"|"STAFF_FREE";
function verdict(cost:{known:number;unpriced:string[]}) {
  return cost.unpriced.length===0 ? "COGS cubierto" : "Sin precio: "+cost.unpriced.join(", ");
}

export function FinancialWorkbench({data}:{data:Data}){
  const [fixed,setFixed]=useState<Record<string,number>>(
    Object.fromEntries(defaultFixed.map(e=>[e.key,e.amount])));
  const [variableRatio,setVariableRatio]=useState(30);
  const [cardRate,setCardRate]=useState(3.5);
  const [taxReserve,setTaxReserve]=useState(0);
  const [extraCost,setExtraCost]=useState(0);
  const [productId,setProductId]=useState(data.menu[0]?.id??"");
  const [service,setService]=useState<Mode>("DINE_IN");
  const [promo,setPromo]=useState<Promo>("NONE");
  const [filter,setFilter]=useState("");
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{
      try {
        const saved=JSON.parse(window.localStorage.getItem("epico-finance-sandbox-v1")||"{}");
        if(saved.fixed && typeof saved.fixed==="object") setFixed((v)=>({...v,...saved.fixed}));
        if(typeof saved.variableRatio==="number")setVariableRatio(saved.variableRatio);
        if(typeof saved.cardRate==="number")setCardRate(saved.cardRate);
        if(typeof saved.taxReserve==="number")setTaxReserve(saved.taxReserve);
        if(typeof saved.extraCost==="number")setExtraCost(saved.extraCost);
      }catch{/* Local storage opcional. */}
      setHydrated(true);
    },0);
    return ()=>window.clearTimeout(timeout);
  },[]);
  useEffect(()=>{
    if(!hydrated)return;
    try{window.localStorage.setItem("epico-finance-sandbox-v1",JSON.stringify(
      {fixed,variableRatio,cardRate,taxReserve,extraCost}
    ));}catch{/* Vista de simulación operativa. */}
  },[fixed,variableRatio,cardRate,taxReserve,extraCost,hydrated]);

  const knownCogs=data.lines.reduce((s,l)=>s+l.cost.known,0);
  const counted=data.lines.reduce((s,l)=>s+l.cost.components,0);
  const priced=data.lines.reduce((s,l)=>s+l.cost.priced,0);
  const unpriced=[...new Set(data.lines.flatMap(l=>l.cost.unpriced))].sort();
  const packaging=data.lines.reduce((s,l)=>s+l.cost.packaging,0);
  const dine=data.lines.filter(x=>x.service==="DINE_IN");
  const takeaway=data.lines.filter(x=>x.service==="TAKEAWAY");
  const fixedMonthly=Object.values(fixed).reduce((a,b)=>a+number(b),0);
  const totalDays=monthDays(data.month);
  const currentDay=Math.min(totalDays,Number(new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Mexico_City",day:"numeric"
  }).format(new Date())));
  const proratedFixed=round(fixedMonthly*currentDay/totalDays);
  const cardSales=data.payments.CARD??0;
  const cardCost=round(cardSales*cardRate/100);
  const contribution=round(data.sales-knownCogs-cardCost);
  const upperNet=round(contribution-proratedFixed-taxReserve-extraCost);
  const unitAverage=data.orders?data.sales/data.orders:0;
  const variableRate=variableRatio/100 + (data.sales>0?cardCost/data.sales:0);
  const breakEven=variableRate<1?fixedMonthly/(1-variableRate):null;
  const breakEvenTickets=breakEven!==null&&unitAverage>0?Math.ceil(breakEven/unitAverage):null;

  const chosen=data.menu.find(x=>x.id===productId);
  const canThermos=service==="THERMOS" && chosen?.category!=="ALIMENTOS";
  const actualPromo:Promo = promo==="THERMOS_10" && !canThermos ? "NONE"
    : promo==="STAFF_FREE" ? "STAFF_FREE" : promo==="STAFF_10" && canThermos ? "NONE" : promo;
  const modeCost=chosen?(service==="DINE_IN"?chosen.dineIn:
    service==="THERMOS"?chosen.thermos:chosen.takeaway):null;
  const baseCost=chosen?(service==="DINE_IN"?chosen.dineIn:chosen.takeaway):null;
  const discount=chosen&&(actualPromo==="THERMOS_10"||actualPromo==="STAFF_10")?round(chosen.price*.1)
    : actualPromo==="STAFF_FREE"&&chosen?chosen.price:0;
  const finalPrice=chosen?round(chosen.price-discount):0;
  const baseMargin=chosen&&baseCost?round(chosen.price-baseCost.known):0;
  const effectiveMargin=modeCost?round(finalPrice-modeCost.known):0;
  const discountBlocked=promo==="THERMOS_10"&&!canThermos ||
    promo==="STAFF_10"&&canThermos;
  const desc=discountBlocked
    ?"No aplicable: descuentos por termo y de colaboradora no se acumulan."
    : actualPromo==="STAFF_FREE"
      ?"Bebida de cortesía incluida en la prestación diaria: ingreso $0, el insumo sí es costo de personal. Una cortesía por turno requiere control nominal."
      : actualPromo==="STAFF_10"
        ?"Simulación para bebidas adicionales de Azucena, posteriores a la cortesía incluida. Requiere identificación y registro en POS."
        : actualPromo==="THERMOS_10"
          ?"Termo propio para llevar: 10% de descuento; receta sin vaso, tapa, manga ni popote desechable."
          :"Sin promoción.";

  const products=useMemo(()=>{
    return data.lines.reduce<Record<string,{name:string;mode:string;units:number;income:number;cost:number;unpriced:Set<string>}>>((out,l)=>{
      const id=l.name+"|"+l.service;
      const row=out[id]??{name:l.name,mode:l.service,units:0,income:0,cost:0,unpriced:new Set<string>()};
      row.units+=l.units;row.income+=l.revenue;row.cost+=l.cost.known;
      l.cost.unpriced.forEach(n=>row.unpriced.add(n));out[id]=row;return out;
    },{});
  },[data.lines]);

  return <div className="stack">
    <section className="grid">
      <article className="card"><p className="eyebrow">VENTAS OPS LIVE · {data.month}</p>
        <div className="metric">{money.format(data.sales)}</div><p>{data.orders} cuentas pagadas</p>
        <small className="muted">Desde {data.saleStart?new Date(data.saleStart).toLocaleDateString("es-MX",{timeZone:"America/Mexico_City"}):"sin cobros"} · no es toda la facturación histórica</small>
      </article>
      <article className="card"><p className="eyebrow">COGS CONOCIDO</p><div className="metric">{money.format(knownCogs)}</div>
        <p>Componentes costificados: {priced}/{counted}</p>
        <small className="muted">{counted?Math.round(priced/counted*100):0}% cobertura; faltantes no contados como costo cero</small></article>
      <article className="card"><p className="eyebrow">FIJOS MENSUALES · PRESUPUESTO</p>
        <div className="metric">{money.format(fixedMonthly)}</div>
        <p>Devengado proporcional estimado: {money.format(proratedFixed)}</p></article>
      <article className="card"><p className="eyebrow">TECHO PROVISIONAL DE UTILIDAD</p>
        <div className="metric">{money.format(upperNet)}</div>
        <p className="status-warn">NO es utilidad libre auditada</p>
        <small className="muted">Descontados costos conocidos, gasto fijo proporcional, comisión modelada y reservas. Falta COGS no valorizado.</small></article>
    </section>

    <section className="card stack">
      <h2>Conciliación financiera · mes en curso</h2>
      <p className="muted">Los gastos son supuestos editables; no equivalen a facturas pagadas ni salen de caja. No se suman aquí ventas de Loyverse ni tickets SHADOW.</p>
      <div className="table-scroll"><table>
        <tbody>
        {[
          ["Ventas pagadas OPS LIVE",data.sales],
          ["− Costo de insumos y empaque con precio conocido",-knownCogs],
          ["− Comisión tarjeta modelada ("+cardRate+"% de "+money.format(cardSales)+")",-cardCost],
          ["= Contribución provisional",contribution],
          ["− Fijos devengados estimados ("+currentDay+"/"+totalDays+" del mes)",-proratedFixed],
          ["− Reservas fiscales ingresadas manualmente",-taxReserve],
          ["− Extraordinarios ingresados manualmente",-extraCost],
          ["= Techo provisional, sujeto a costos faltantes",upperNet]
        ].map(([label,value],i)=><tr key={String(label)}><td>{i===7?<strong>{String(label)}</strong>:String(label)}</td>
          <td style={{textAlign:"right"}}><strong>{money.format(Number(value))}</strong></td></tr>)}
        </tbody>
      </table></div>
      <p className="status-warn">Componentes sin costo: {unpriced.length?unpriced.join(", "):"ninguno identificado en las líneas registradas"}. Si faltan, la utilidad aparente está sobreestimada. Descuentos reales pendientes: esta pantalla sólo simula reglas nuevas.</p>
      <div className="grid">
      {defaultFixed.map(e=><label key={e.key}>{e.name} · MXN/mes
        <input type="number" min="0" step="0.01" value={fixed[e.key]??0}
          onChange={ev=>setFixed(c=>({...c,[e.key]:Math.max(0,Number(ev.target.value)||0)}))}/>
      </label>)}
      <label>Comisión tarjeta estimada (%)
        <input type="number" min="0" max="30" step="0.1" value={cardRate}
          onChange={e=>setCardRate(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
      <label>Reserva fiscal a descontar este mes ($)
        <input type="number" min="0" step="0.01" value={taxReserve}
          onChange={e=>setTaxReserve(Math.max(0,Number(e.target.value)||0))}/></label>
      <label>Gastos extraordinarios del mes ($)
        <input type="number" min="0" step="0.01" value={extraCost}
          onChange={e=>setExtraCost(Math.max(0,Number(e.target.value)||0))}/></label>
      </div>
      <small className="muted">La reserva fiscal NO representa automáticamente IVA ni ISR RESICO. Para utilidad neta validada se requiere separar IVA trasladado/acreditable, ISR efectivo, depreciación y comprobar desembolsos y precios.</small>
    </section>

    <section className="grid">
      <article className="card stack">
        <h2>Punto de equilibrio mensual</h2>
        <label>Costo variable asumido (% de ventas; escenario, no dato real)
          <input type="range" min="10" max="75" step="1" value={variableRatio} onChange={e=>setVariableRatio(Number(e.target.value))}/>
          <strong>{variableRatio}% + comisiones proporcionales</strong>
        </label>
        <div className="metric">{breakEven===null?"Sin equilibrio":money.format(breakEven)}</div>
        <p>{breakEvenTickets===null?"Sin promedio confiable":breakEvenTickets+" tickets/mes ("+Math.ceil(breakEvenTickets/totalDays)+"/día)"} al ticket observado de {money.format(unitAverage)}.</p>
        <small className="muted">Hipótesis: gastos fijos mensuales / (1−% variable). No usar cobertura incompleta como margen real.</small>
      </article>
      <article className="card stack">
        <h2>Servicio y desechables · ventas observadas</h2>
        <p><strong>Aquí:</strong> {dine.reduce((s,l)=>s+l.units,0)} unidades · {money.format(dine.reduce((s,l)=>s+l.revenue,0))}</p>
        <p><strong>Para llevar:</strong> {takeaway.reduce((s,l)=>s+l.units,0)} unidades · {money.format(takeaway.reduce((s,l)=>s+l.revenue,0))}</p>
        <p>Empaque con costo registrado: {money.format(packaging)}</p>
        <small className="muted">El costo se toma de cada receta congelada según servicio. Bebidas frías aquí pueden conservar popote; no cargamos vasos/tapas cuando la receta es correcta.</small>
      </article>
    </section>

    <section className="card stack">
      <h2>Utilidad por bebida y modalidad · ventas reales OPS</h2>
      <input placeholder="Filtrar bebida" value={filter} onChange={e=>setFilter(e.target.value)}/>
      <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Servicio</th><th>Uds.</th><th>Venta</th><th>COGS identificado</th><th>Contribución máxima</th><th>Cobertura</th></tr></thead>
      <tbody>{Object.values(products).filter(x=>x.name.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>b.income-a.income).map(x=><tr key={x.name+x.mode}>
        <td>{x.name}</td><td>{x.mode==="DINE_IN"?"Aquí":"Llevar"}</td><td>{x.units}</td>
        <td>{money.format(x.income)}</td><td>{money.format(x.cost)}</td><td>{money.format(x.income-x.cost)}</td>
        <td>{x.unpriced.size?"Falta "+Array.from(x.unpriced).join(", "):"Completa"}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card stack">
      <p className="eyebrow">LABORATORIO DE PROMOCIONES · SOLO PREVIEW</p>
      <h2>Descuentos programados 10% y cortesía Azucena</h2>
      <p className="muted">Simulación con recetas vigentes: no modifica el POS LIVE, sus tickets, puntos ni inventario hasta aprobar el flujo de cobro completo.</p>
      <div className="grid">
        <label>Producto <select value={productId} onChange={e=>setProductId(e.target.value)}>
          {data.menu.map(x=><option key={x.id} value={x.id}>{x.name} · {money.format(x.price)}</option>)}</select></label>
        <label>Presentación
          <select value={service} onChange={e=>{setService(e.target.value as Mode);setPromo("NONE");}}>
            <option value="DINE_IN">Consumo aquí</option><option value="TAKEAWAY">Para llevar / vaso desechable</option>
            <option value="THERMOS">Para llevar / termo propio</option>
          </select></label>
        <label>Regla
          <select value={promo} onChange={e=>setPromo(e.target.value as Promo)}>
            <option value="NONE">Precio normal</option>
            <option value="THERMOS_10">10% termo propio</option>
            <option value="STAFF_10">10% Azucena · bebida adicional</option>
            <option value="STAFF_FREE">Cortesía de Azucena · primera bebida</option>
          </select>
        </label>
      </div>
      <p className={discountBlocked?"status-warn":"muted"}>{desc}</p>
      {chosen&&modeCost&&<div className="grid">
        <article className="card"><p className="eyebrow">PRECIO BASE</p><div className="metric">{money.format(chosen.price)}</div></article>
        <article className="card"><p className="eyebrow">DESCUENTO</p><div className="metric">{money.format(discount)}</div></article>
        <article className="card"><p className="eyebrow">PRECIO FINAL</p><div className="metric">{money.format(finalPrice)}</div></article>
        <article className="card"><p className="eyebrow">CONTRIBUCIÓN IDENTIFICADA</p><div className="metric">{money.format(effectiveMargin)}</div>
          <small className="muted">{verdict(modeCost)} · sin fijos ni comisión</small></article>
      </div>}
      {chosen&&modeCost&&<p className="muted">Costo conocido receta: {money.format(modeCost.known)} · empaque: {money.format(modeCost.packaging)} · variación de contribución vs precio normal de esa presentación: {money.format(effectiveMargin-baseMargin)}. Para termo el ahorro está condicionado a que las piezas descartadas tengan precio cargado.</p>}
      <p className="status-warn">Reglas a instrumentar al cobrar: autorización por rol, validación de termo, límite de 1 cortesía diaria, elegibilidad de Azucena, descuento por línea (no por ticket), bloqueo de acumulaciones y auditoría. El primer consumo gratuito debe registrarse para descontar ingredientes aunque no genere venta.</p>
    </section>
  </div>;
}
