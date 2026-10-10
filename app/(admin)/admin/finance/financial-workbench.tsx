"use client";

import { useEffect, useMemo, useState } from "react";
import type { getFinancialPreview } from "@/src/application/finance/preview";
import { saveSharedFinancialBudget } from "./actions";
import { defaultExpenses, type FinancialExpense as Expense, type FinancialBudgetSnapshot, type FinancialBudgetPayload } from "@/src/domain/finance/budget";
import {afterTaxRevenueRatio, estimateTaxesOnGrossSales, IVA_RATE_PERCENT, ISR_RESICO_ASSUMED_RATE_PERCENT} from "@/src/domain/finance/taxes";

type Data = Awaited<ReturnType<typeof getFinancialPreview>>;
const money = new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",maximumFractionDigits:2});
const round = (x:number) => Math.round(x*100)/100;
const validMoney=(amount:unknown)=>Number.isFinite(Number(amount))
  ?Math.max(0,Math.min(100000000,Math.round(Number(amount)*100)/100)):0;
function restoreExpenses(raw:unknown):Expense[]|null{
  if(!Array.isArray(raw))return null;
  return raw.filter((value):value is Record<string,unknown>=>
    Boolean(value)&&typeof value==="object"&&!Array.isArray(value))
    .map((e,index)=>({
      id:typeof e.id==="string"&&e.id.length>0?e.id:"restored-"+index,
      name:typeof e.name==="string"?e.name.slice(0,100):"Sin concepto",
      amount:String(validMoney(e.amount)),
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

export function FinancialWorkbench({data,sharedBudget}:{
  data:Data;sharedBudget:FinancialBudgetSnapshot|null;
}){
  const [expenses,setExpenses]=useState<Expense[]>(sharedBudget?.expenses??defaultExpenses);
  const [variableRatio,setVariableRatio]=useState(sharedBudget?.variableRatio??30);
  const [cardRate,setCardRate]=useState(sharedBudget?.cardRate??3.5);
  const [revision,setRevision]=useState(sharedBudget?.revision??0);
  const [savedAt,setSavedAt]=useState(sharedBudget?.updatedAt??"");
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [saveMessage,setSaveMessage]=useState("");
  const [localBackup,setLocalBackup]=useState<FinancialBudgetPayload|null>(null);
  const [legacyTaxWarning,setLegacyTaxWarning]=useState(false);
  const [productId,setProductId]=useState(data.menu[0]?.id??"");
  const [service,setService]=useState<Mode>("DINE_IN");
  const [promo,setPromo]=useState<Promo>("NONE");
  const [filter,setFilter]=useState("");
  const [hydrated,setHydrated]=useState(false);
  // Explicit save is required to update shared OPS scenario. Local drafts stay
  // local; neither save path creates bank/payment or fiscal transactions.
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{
      try{
        const savedV2=JSON.parse(window.localStorage.getItem("epico-finance-sandbox-v2")||"null");
        const restored=restoreExpenses(savedV2?.expenses);
        if(sharedBudget){
          // Don't overwrite the shared budget silently with an old local scenario.
          // Offer to recover different unsaved local estimates manually.
          if(restored){
            const backup:FinancialBudgetPayload={
              expenses:restored,
              variableRatio:typeof savedV2.variableRatio==="number"?savedV2.variableRatio:30,
              cardRate:typeof savedV2.cardRate==="number"?savedV2.cardRate:3.5,
            };
            const shared:FinancialBudgetPayload={
              expenses:sharedBudget.expenses,variableRatio:sharedBudget.variableRatio,
              cardRate:sharedBudget.cardRate,
            };
            if(JSON.stringify(backup)!==JSON.stringify(shared))setLocalBackup(backup);
          }
        }else if(restored){
          setExpenses(restored);
          if(typeof savedV2.variableRatio==="number")setVariableRatio(savedV2.variableRatio);
          if(typeof savedV2.cardRate==="number")setCardRate(savedV2.cardRate);
        }else{
          // Migrar el presupuesto previo para no perder gastos escritos por el propietario.
          const old=JSON.parse(window.localStorage.getItem("epico-finance-sandbox-v1")||"{}");
          const priorFixed=old.fixed&&typeof old.fixed==="object"?old.fixed:{};
          const migrated=defaultExpenses.map(e=>({...e,amount:String(validMoney(priorFixed[e.id]??e.amount))}));
          const historicExtra=validMoney(old.extraCost);
          if(historicExtra>0)migrated.push({
            id:"gasto-previo-adicional",name:"Extraordinarios anteriores",amount:String(historicExtra),
            recurrence:"ONE_OFF",classification:"VARIABLE",month:data.month,status:"ESTIMATED"
          });
          for(const key of ["mantenimiento","otros"]){
            if(validMoney(priorFixed[key])>0)migrated.push({
              id:key,name:key==="mantenimiento"?"Mantenimiento y reparaciones":"Otros gastos corrientes",
              amount:String(validMoney(priorFixed[key])),recurrence:"MONTHLY",
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
  },[data.month,sharedBudget]);
  useEffect(()=>{
    if(!hydrated||(!dirty&&sharedBudget))return;
    try{window.localStorage.setItem("epico-finance-sandbox-v2",JSON.stringify(
      {expenses,variableRatio,cardRate}
    ));}catch{/* Local draft storage is best effort. */}
  },[expenses,variableRatio,cardRate,hydrated,dirty,sharedBudget]);

  const updateExpense=(id:string,patch:Partial<Expense>)=>{
    setDirty(true);setSaveMessage("");
    setExpenses(rows=>rows.map(e=>e.id===id?{...e,...patch}:e));
  };
  const addExpense=()=>{
    setDirty(true);setSaveMessage("");
    setExpenses(rows=>[...rows,{
      id:crypto.randomUUID(),name:"Nuevo gasto",amount:"0",
      recurrence:"ONE_OFF",classification:"VARIABLE",month:data.month,status:"ESTIMATED"
    }]);
  };
  async function saveBudget(){
    if(saving)return;
    setSaving(true);setSaveMessage("");
    try{
      const result=await saveSharedFinancialBudget(
        {expenses,variableRatio,cardRate},revision,
      );
      if(result.ok){
        setRevision(result.revision);setSavedAt(result.updatedAt);
        setDirty(false);setLocalBackup(null);
        setSaveMessage("Presupuesto guardado en OPS. Ya puedes abrirlo desde otro dispositivo.");
      }else setSaveMessage(result.message);
    }catch{
      setSaveMessage("No se pudo confirmar el guardado. Revisa tu conexión antes de volver a intentarlo.");
    }finally{setSaving(false);}
  }
  function recoverLocalBackup(){
    if(!localBackup)return;
    setExpenses(localBackup.expenses);
    setVariableRatio(localBackup.variableRatio);
    setCardRate(localBackup.cardRate);
    setLocalBackup(null);setDirty(true);
    setSaveMessage("Borrador recuperado. Revisa los importes antes de guardarlo en OPS.");
  }

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
    .reduce((sum,e)=>sum+validMoney(e.amount),0));
  const variableMonthly=round(recurring.filter(e=>e.classification==="VARIABLE")
    .reduce((sum,e)=>sum+validMoney(e.amount),0));
  const totalMonthly=round(fixedMonthly+variableMonthly);
  const oneTimeExpense=round(oneTime.reduce((sum,e)=>sum+validMoney(e.amount),0));
  const totalDays=monthDays(data.month);
  const currentDay=Math.min(totalDays,Number(new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Mexico_City",day:"numeric"
  }).format(new Date())));
  const proratedMonthly=round(totalMonthly*currentDay/totalDays);
  const expenseCharge=round(proratedMonthly+oneTimeExpense);
  const confirmedExpenses=round(currentExpenses.filter(e=>e.status==="PAID"&&e.month===data.month)
    .reduce((sum,e)=>sum+validMoney(e.amount),0));
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
      <article className="card"><p className="eyebrow">GASTO RECURRENTE MENSUAL</p>
        <div className="metric">{money.format(totalMonthly)}</div>
        <p>Fijos: {money.format(fixedMonthly)} · Otros recurrentes: {money.format(variableMonthly)}</p>
        <small className="muted">+ Puntuales del mes: {money.format(oneTimeExpense)} · cargo presupuestado al día: {money.format(expenseCharge)}</small>
      </article>
      <article className="card"><p className="eyebrow">IVA 16% + ISR RESICO 2%</p>
        <div className="metric">{money.format(taxes.totalTaxes)}</div>
        <p>IVA: {money.format(taxes.vat)} · ISR: {money.format(taxes.isr)}</p>
        <small className="muted">Supuesto: precios con IVA incluido; IVA acreditable $0.</small>
      </article>
      <article className="card"><p className="eyebrow">TECHO PROVISIONAL DESPUÉS DE IMPUESTOS</p>
        <div className="metric">{money.format(upperNet)}</div>
        <p className="status-warn">NO es utilidad libre auditada</p>
        <small className="muted">Incluye impuestos estimados y gastos que captures. Faltan insumos sin precio y conciliar pagos reales.</small>
      </article>
    </section>

    <section className="card stack">
      <h2>Estado de resultados · {data.month}</h2>
      <p className="muted">Ingresos de tickets cobrados OPS LIVE. Todos los precios se suponen con IVA incluido al 16%. No se suman tickets SHADOW, Loyverse ni ingresos de ingeniería ajenos al OPS.</p>
      <div className="table-scroll"><table>
        <tbody>
          {[
            ["Ventas cobradas, IVA incluido",data.sales],
            ["− IVA trasladado 16% (sin IVA acreditable)",-taxes.vat],
            ["= Ventas base sin IVA",taxes.beforeVat],
            ["− ISR RESICO supuesto 2% sobre ingresos sin IVA",-taxes.isr],
            ["− Insumos y empaques con costo conocido",-knownCogs],
            ["− Comisiones de tarjeta estimadas ("+cardRate+"% de "+money.format(cardSales)+")",-cardCost],
            ["= Contribución provisional después de impuestos",contribution],
            ["− Gastos mensuales proporcionales ("+currentDay+"/"+totalDays+" días)",-proratedMonthly],
            ["− Gastos puntuales del mes",-oneTimeExpense],
            ["= Resultado provisional antes de costos faltantes",upperNet]
          ].map(([label,value],i)=><tr key={String(label)}>
            <td>{[2,6,9].includes(i)?<strong>{String(label)}</strong>:String(label)}</td>
            <td style={{textAlign:"right"}}><strong>{money.format(Number(value))}</strong></td>
          </tr>)}
        </tbody>
      </table></div>
      <small className="muted">Control fiscal parametrizado: IVA {IVA_RATE_PERCENT}% sobre venta base, acreditamiento $0; ISR {ISR_RESICO_ASSUMED_RATE_PERCENT}% sobre venta base sin IVA, sin deducción de gastos. Ejemplo: $116 cobrados = $100 base + $16 IVA + $2 de ISR; tras impuestos quedan $98 antes de costos. Son proyecciones operativas, no determinación fiscal oficial.</small>
      {legacyTaxWarning&&<p className="status-warn">La antigua reserva fiscal manual no se trasladó al nuevo simulador para evitar duplicar IVA e ISR. Los demás gastos anteriores sí se conservaron.</p>}
      <p className="status-warn">Insumos sin precio: {unpriced.length?unpriced.join(", "):"ninguno identificado"}. Faltantes no implican costo cero. Los gastos capturados aquí son presupuestos o registros manuales, no comprobantes bancarios conciliados.</p>
    </section>

    <section className="card stack ops-finance-workbench">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONTROL DE GASTOS · EDITABLE</p>
          <h2>Gastos corrientes, fijos y extraordinarios</h2>
        </div>
        <button type="button" onClick={addExpense}>+ Añadir gasto</button>
      </div>
      <div className="ops-budget-save-panel">
        <div>
          <strong>{dirty?"Cambios sin guardar en OPS":revision>0?"Presupuesto compartido en OPS":"Presupuesto sin publicar"}</strong>
          <p className="muted">
            {revision>0?"Versión "+revision+" · Último guardado "+new Date(savedAt).toLocaleString("es-MX",{timeZone:"America/Mexico_City"}):
              "El presupuesto actual no está guardado en el servidor."}
            {" "}Los registros marcados como pagados son manuales, sin conciliación bancaria.
          </p>
        </div>
        <button type="button" onClick={()=>void saveBudget()} disabled={saving}>
          {saving?"Guardando…":"Guardar presupuesto en OPS"}
        </button>
      </div>
      {localBackup&&<div className="ops-inline-notice">
        Se encontró un presupuesto anterior en este navegador. El compartido tiene prioridad.
        <button type="button" className="ops-action-soft" onClick={recoverLocalBackup}>
          Recuperar borrador local
        </button>
      </div>}
      {saveMessage&&<p role="status" className={dirty?"status-warn":"status-ok"}>{saveMessage}</p>}
      <p className="muted">Puedes modificar conceptos, añadir gastos y eliminarlos. Mensual: se prorratea hasta hoy; puntual: se descuenta completo sólo en {data.month}. Para compartir cambios con otros dispositivos pulsa «Guardar presupuesto en OPS».</p>
      <div className="table-scroll ops-finance-expenses"><table>
        <thead><tr><th>Concepto</th><th>Tipo</th><th>Periodicidad</th><th>Importe MXN</th><th>Registro</th><th>Acción</th></tr></thead>
        <tbody>
          {currentExpenses.map(e=><tr key={e.id}>
            <td><input aria-label={"Concepto de gasto "+e.id} value={e.name}
              maxLength={100} onChange={event=>updateExpense(e.id,{name:event.target.value})}/></td>
            <td><select aria-label={"Clasificación de "+e.name} value={e.classification}
              onChange={event=>updateExpense(e.id,{classification:event.target.value as Expense["classification"]})}>
              <option value="FIXED">Fijo</option><option value="VARIABLE">Variable</option>
            </select></td>
            <td><select aria-label={"Periodicidad de "+e.name} value={e.recurrence}
              onChange={event=>updateExpense(e.id,{recurrence:event.target.value as Expense["recurrence"],month:data.month})}>
              <option value="MONTHLY">Mensual</option><option value="ONE_OFF">Sólo este mes</option>
            </select></td>
            <td><input aria-label={"Importe de "+e.name} type="number" min="0" max="100000000" step="0.01"
              value={e.amount} onChange={event=>updateExpense(e.id,{amount:event.target.value})}/></td>
            <td><select aria-label={"Estado de "+e.name} value={e.status==="PAID"&&e.month===data.month?"PAID":"ESTIMATED"}
              onChange={event=>updateExpense(e.id,{
                status:event.target.value as Expense["status"],
                month:e.recurrence==="ONE_OFF"||event.target.value==="PAID"?data.month:""
              })}>
              <option value="ESTIMATED">Estimado</option><option value="PAID">Pagado (manual)</option>
            </select></td>
            <td><button type="button" onClick={()=>{setDirty(true);setExpenses(rows=>rows.filter(x=>x.id!==e.id));}}
              aria-label={"Eliminar "+e.name}>Quitar</button></td>
          </tr>)}
        </tbody>
      </table></div>
      <button type="button" className="button" onClick={addExpense}>+ Añadir otro gasto</button>
      <div className="grid">
        <article className="card"><p className="eyebrow">FIJOS MENSUALES</p><div className="metric">{money.format(fixedMonthly)}</div></article>
        <article className="card"><p className="eyebrow">VARIABLES MENSUALES</p><div className="metric">{money.format(variableMonthly)}</div></article>
        <article className="card"><p className="eyebrow">PUNTUALES DEL MES</p><div className="metric">{money.format(oneTimeExpense)}</div></article>
        <article className="card"><p className="eyebrow">MARCADOS COMO PAGADOS</p><div className="metric">{money.format(confirmedExpenses)}</div>
          <small className="muted">Marcación manual; aún no conciliado</small></article>
      </div>
      <label>Comisión tarjeta estimada (% cobrado en tarjeta)
        <input type="number" min="0" max="30" step="0.1" value={cardRate}
          onChange={e=>{setDirty(true);setCardRate(Math.max(0,Math.min(30,Number(e.target.value)||0)));}}/></label>
      <p className="muted">No captures nuevamente IVA o ISR como gasto: se calculan automáticamente arriba. Evita duplicar comisiones si ya las incluyes como un gasto manual. El porcentaje variable para punto de equilibrio representa COGS y otros costos ligados directamente a la venta.</p>
    </section>

    <section className="grid">
      <article className="card stack">
        <h2>Punto de equilibrio mensual</h2>
        <label>Costo variable asumido (% de ventas; escenario, no dato real)
          <input type="range" min="10" max="75" step="1" value={variableRatio} onChange={e=>{setDirty(true);setVariableRatio(Number(e.target.value));}}/>
          <strong>{variableRatio}% sobre ventas con IVA + tasa efectiva de tarjeta + IVA/ISR</strong>
        </label>
        <div className="metric">{breakEven===null?"Sin equilibrio":money.format(breakEven)}</div>
        <p>{breakEvenTickets===null?"Sin promedio confiable":breakEvenTickets+" tickets/mes ("+Math.ceil(breakEvenTickets/totalDays)+"/día)"} al ticket observado de {money.format(unitAverage)}.</p>
        <small className="muted">Escenario: (gastos mensuales + puntuales del mes) / ({(afterTaxRevenueRatio*100).toFixed(2)}% de ingresos después de IVA/ISR − {variableRatio}% costo variable − comisión ponderada). El porcentaje variable es una hipótesis; no corresponde automáticamente al COGS incompleto.</small>
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
      <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Servicio</th><th>Uds.</th><th>Venta</th><th>COGS identificado</th><th>Máximo tras IVA/ISR y COGS conocido</th><th>Cobertura</th></tr></thead>
      <tbody>{Object.values(products).filter(x=>x.name.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>b.income-a.income).map(x=><tr key={x.name+x.mode}>
        <td>{x.name}</td><td>{x.mode==="DINE_IN"?"Aquí":"Llevar"}</td><td>{x.units}</td>
        <td>{money.format(x.income)}</td><td>{money.format(x.cost)}</td><td>{money.format(estimateTaxesOnGrossSales(x.income).afterTaxes-x.cost)}</td>
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
        <article className="card"><p className="eyebrow">CONTRIBUCIÓN POST IVA/ISR</p><div className="metric">{money.format(effectiveMargin)}</div>
          <small className="muted">{verdict(modeCost)} · sin fijos ni comisión; IVA 16%, ISR 2%</small></article>
      </div>}
      {chosen&&modeCost&&<p className="muted">Costo conocido receta: {money.format(modeCost.known)} · empaque: {money.format(modeCost.packaging)} · IVA estimado: {money.format(estimateTaxesOnGrossSales(finalPrice).vat)} · ISR estimado: {money.format(estimateTaxesOnGrossSales(finalPrice).isr)} · variación de contribución vs precio normal de esa presentación: {money.format(effectiveMargin-baseMargin)}. Para termo el ahorro está condicionado a que las piezas descartadas tengan precio cargado.</p>}
      <p className="status-warn">Reglas a instrumentar al cobrar: autorización por rol, validación de termo, límite de 1 cortesía diaria, elegibilidad de Azucena, descuento por línea (no por ticket), bloqueo de acumulaciones y auditoría. El primer consumo gratuito debe registrarse para descontar ingredientes aunque no genere venta.</p>
    </section>
  </div>;
}
