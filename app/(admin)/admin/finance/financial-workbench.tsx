"use client";

import { useEffect, useMemo, useState } from "react";
import type { getFinancialPreview } from "@/src/application/finance/preview";
import {afterTaxRevenueRatio, estimateTaxesOnGrossSales, IVA_RATE_PERCENT, ISR_RESICO_ASSUMED_RATE_PERCENT} from "@/src/domain/finance/taxes";

type Data = Awaited<ReturnType<typeof getFinancialPreview>>;
const money = new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",maximumFractionDigits:2});
const number = (x:number) => Number.isFinite(x) ? x : 0;
const round = (x:number) => Math.round(x*100)/100;
type Expense = {
  id:string;
  name:string;
  amount:number;
  recurrence:"MONTHLY"|"ONE_OFF";
  classification:"FIXED"|"VARIABLE";
  month:string;
  status:"ESTIMATED"|"PAID";
};
const expenseDefaults:Expense[] = [
  {id:"nomina",name:"Nómina estructural",amount:8000,recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"renta",name:"Renta del local",amount:4000,recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"electricidad",name:"Electricidad",amount:700,recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"internet",name:"Internet",amount:500,recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
  {id:"contadora",name:"Honorarios contables",amount:1000,recurrence:"MONTHLY",classification:"FIXED",month:"",status:"ESTIMATED"},
];
const validMoney=(amount:unknown)=>Number.isFinite(Number(amount))
  ?Math.max(0,Math.min(100000000,Math.round(Number(amount)*100)/100)):0;
function restoreExpenses(raw:unknown):Expense[]|null{
  if(!Array.isArray(raw))return null;
  return raw.filter((value):value is Record<string,unknown>=>
    Boolean(value)&&typeof value==="object"&&!Array.isArray(value))
    .slice(0,120).map((e,index)=>({
      id:typeof e.id==="string"&&e.id.length>0?e.id:"restored-"+index,
      name:typeof e.name==="string"?e.name.slice(0,100):"Sin concepto",
      amount:validMoney(e.amount),
      recurrence:e.recurrence==="ONE_OFF"?"ONE_OFF":"MONTHLY",
      classification:e.classification==="VARIABLE"?"VARIABLE":"FIXED",
      month:typeof e.month==="string"&&/^\d{4}-\d{2}$/.test(e.month)?e.month:"",
      status:e.status==="PAID"?"PAID":"ESTIMATED",
    }));
}
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
  const [expenses,setExpenses]=useState<Expense[]>(expenseDefaults);
  const [variableRatio,setVariableRatio]=useState(30);
  const [cardRate,setCardRate]=useState(3.5);
  const [legacyTaxWarning,setLegacyTaxWarning]=useState(false);
  const [productId,setProductId]=useState(data.menu[0]?.id??"");
  const [service,setService]=useState<Mode>("DINE_IN");
  const [promo,setPromo]=useState<Promo>("NONE");
  const [filter,setFilter]=useState("");
  const [hydrated,setHydrated]=useState(false);
  // Preview: datos privados del escenario en el navegador. No escribe en Supabase,
  // ni registra movimientos contables ni modifica la caja de producción.
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{
      try{
        const savedV2=JSON.parse(window.localStorage.getItem("epico-finance-sandbox-v2")||"null");
        const restored=restoreExpenses(savedV2?.expenses);
        if(restored){
          setExpenses(restored);
          if(typeof savedV2.variableRatio==="number")setVariableRatio(savedV2.variableRatio);
          if(typeof savedV2.cardRate==="number")setCardRate(savedV2.cardRate);
        }else{
          // Migrar el presupuesto previo para no perder gastos escritos por el propietario.
          const old=JSON.parse(window.localStorage.getItem("epico-finance-sandbox-v1")||"{}");
          const priorFixed=old.fixed&&typeof old.fixed==="object"?old.fixed:{};
          const migrated=expenseDefaults.map(e=>({...e,amount:validMoney(priorFixed[e.id]??e.amount)}));
          const historicExtra=validMoney(old.extraCost);
          if(historicExtra>0)migrated.push({
            id:"gasto-previo-adicional",name:"Extraordinarios anteriores",amount:historicExtra,
            recurrence:"ONE_OFF",classification:"VARIABLE",month:data.month,status:"ESTIMATED"
          });
          for(const key of ["mantenimiento","otros"]){
            if(validMoney(priorFixed[key])>0)migrated.push({
              id:key,name:key==="mantenimiento"?"Mantenimiento y reparaciones":"Otros gastos corrientes",
              amount:validMoney(priorFixed[key]),recurrence:"MONTHLY",
              classification:"FIXED",month:"",status:"ESTIMATED"
            });
          }
          setExpenses(migrated);
          if(typeof old.variableRatio==="number")setVariableRatio(old.variableRatio);
          if(typeof old.cardRate==="number")setCardRate(old.cardRate);
          // Reserva fiscal antigua no se migra: ahora IVA + ISR son automáticos.
          if(validMoney(old.taxReserve)>0)setLegacyTaxWarning(true);
        }
      }catch{/* Sin almacenamiento local disponible: usar presupuesto inicial. */}
      setHydrated(true);
    },0);
    return ()=>window.clearTimeout(timeout);
  },[data.month]);
  useEffect(()=>{
    if(!hydrated)return;
    try{window.localStorage.setItem("epico-finance-sandbox-v2",JSON.stringify(
      {expenses,variableRatio,cardRate}
    ));}catch{/* El preview funciona sin almacenamiento. */}
  },[expenses,variableRatio,cardRate,hydrated]);

  const updateExpense=(id:string,patch:Partial<Expense>)=>
    setExpenses(rows=>rows.map(e=>e.id===id?{...e,...patch}:e));
  const addExpense=()=>setExpenses(rows=>[...rows,{
    id:crypto.randomUUID(),name:"Nuevo gasto",amount:0,
    recurrence:"ONE_OFF",classification:"VARIABLE",month:data.month,status:"ESTIMATED"
  }]);

  const knownCogs=data.lines.reduce((s,l)=>s+l.cost.known,0);
  const counted=data.lines.reduce((s,l)=>s+l.cost.components,0);
  const priced=data.lines.reduce((s,l)=>s+l.cost.priced,0);
  const unpriced=[...new Set(data.lines.flatMap(l=>l.cost.unpriced))].sort();
  const packaging=data.lines.reduce((s,l)=>s+l.cost.packaging,0);
  const dine=data.lines.filter(x=>x.service==="DINE_IN");
  const takeaway=data.lines.filter(x=>x.service==="TAKEAWAY");
  const currentExpenses=expenses.filter(e=>e.recurrence==="MONTHLY"||e.month===data.month);
  const recurring=currentExpenses.filter(e=>e.recurrence==="MONTHLY");
  const oneTime=currentExpenses.filter(e=>e.recurrence==="ONE_OFF");
  const fixedMonthly=round(recurring.filter(e=>e.classification==="FIXED")
    .reduce((sum,e)=>sum+e.amount,0));
  const variableMonthly=round(recurring.filter(e=>e.classification==="VARIABLE")
    .reduce((sum,e)=>sum+e.amount,0));
  const totalMonthly=round(fixedMonthly+variableMonthly);
  const oneTimeExpense=round(oneTime.reduce((sum,e)=>sum+e.amount,0));
  const totalDays=monthDays(data.month);
  const currentDay=Math.min(totalDays,Number(new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Mexico_City",day:"numeric"
  }).format(new Date())));
  const proratedMonthly=round(totalMonthly*currentDay/totalDays);
  const expenseCharge=round(proratedMonthly+oneTimeExpense);
  const confirmedExpenses=round(currentExpenses.filter(e=>e.status==="PAID")
    .reduce((sum,e)=>sum+e.amount,0));
  const cardSales=data.payments.CARD??0;
  const cardCost=round(cardSales*cardRate/100);
  // En OPS el precio de venta es público, por tanto IVA está contenido en el cobro.
  const taxes=estimateTaxesOnGrossSales(data.sales);
  const contribution=round(taxes.afterTaxes-knownCogs-cardCost);
  const upperNet=round(contribution-expenseCharge);
  const unitAverage=data.orders?data.sales/data.orders:0;
  const cardShare=data.sales>0?cardSales/data.sales:0;
  const availableRatio=afterTaxRevenueRatio-variableRatio/100-cardShare*cardRate/100;
  // Gastos puntuales del mes elevan la meta excepcionalmente este mes.
  const breakEven=availableRatio>0?(totalMonthly+oneTimeExpense)/availableRatio:null;
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
  const baseMargin=chosen&&baseCost
    ?round(estimateTaxesOnGrossSales(chosen.price).afterTaxes-baseCost.known):0;
  const effectiveMargin=modeCost
    ?round(estimateTaxesOnGrossSales(finalPrice).afterTaxes-modeCost.known):0;
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
