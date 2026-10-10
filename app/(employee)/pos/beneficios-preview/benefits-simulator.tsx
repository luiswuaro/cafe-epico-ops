"use client";

import {useMemo,useState} from "react";
import {
  calculateBenefitPreview,type BenefitKind,type BenefitLine,type Scope,
} from "@/src/domain/pos/benefits-preview";

type Item={id:string;name:string;category:"CALIENTES"|"FRÍAS"|"ALIMENTOS";price:number};
type Customer={id:string;name:string;pointsBalance:number};
const mxn=(value:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(value);

export function BenefitsPreview({catalog,customers}:{catalog:Item[];customers:Customer[]}){
  const [itemId,setItemId]=useState(catalog[0]?.id??"");
  const [lines,setLines]=useState<BenefitLine[]>([]);
  const [kind,setKind]=useState<BenefitKind>("NONE");
  const [scope,setScope]=useState<Scope>("LINE");
  const [lineId,setLineId]=useState("");
  const [value,setValue]=useState("0");
  const [reason,setReason]=useState("");
  const [customerId,setCustomerId]=useState("");
  const [rate,setRate]=useState("");
  const [staffFreeUsed,setStaffFreeUsed]=useState(false);
  const selectedCustomer=customers.find(x=>x.id===customerId);
  const candidate=catalog.find(x=>x.id===itemId);
  const result=useMemo(()=>calculateBenefitPreview(lines,{
    kind,scope,lineId,value:Number(value),reason,
    availablePoints:selectedCustomer?.pointsBalance??0,
    mxnPerPoint:rate.trim()?Number(rate):0,
    staffFreeAlreadyUsed:staffFreeUsed,
  }),[lines,kind,scope,lineId,value,reason,selectedCustomer?.pointsBalance,rate,staffFreeUsed]);

  function add(){
    if(!candidate)return;
    const id=crypto.randomUUID();
    setLines(old=>[...old,{id,name:candidate.name,category:candidate.category,basePrice:candidate.price,extras:0,ownThermos:false}]);
    if(!lineId)setLineId(id);
  }
  function changeKind(next:BenefitKind){
    setKind(next);setValue("0");setReason("");
    if(next==="POINTS"||next==="MANUAL_FIXED"||next==="MANUAL_PERCENT")setScope("TICKET");
    else setScope("LINE");
  }
  const discountEligible=kind==="POINTS"||kind==="MANUAL_FIXED"||kind==="MANUAL_PERCENT";
  return <div className="grid-two" style={{alignItems:"start"}}>
    <section className="card stack">
      <h2>1. Agregar productos</h2>
      <label>Producto del catálogo OPS
        <select value={itemId} onChange={e=>setItemId(e.target.value)}>
          {catalog.map(x=><option key={x.id} value={x.id}>{x.name} · {mxn(x.price)}</option>)}
        </select>
      </label>
      <button type="button" className="button" onClick={add} disabled={!candidate}>+ Agregar al ticket simulado</button>
      {lines.length===0?<p className="muted">Agrega una bebida o alimento para empezar.</p>:lines.map(line=>
        <div key={line.id} className="card stack" style={{padding:12,gap:8}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12}}>
            <strong>{line.name}</strong><strong>{mxn(line.basePrice)}</strong>
          </div>
          <label>Extras (MXN)
            <input type="number" min="0" step=".01" value={line.extras}
              onChange={e=>setLines(old=>old.map(x=>x.id===line.id?{...x,extras:Number(e.target.value)}:x))}/>
          </label>
          {line.category!=="ALIMENTOS"&&<label style={{display:"flex",gap:8,alignItems:"center"}}>
            <input type="checkbox" checked={line.ownThermos}
              onChange={e=>setLines(old=>old.map(x=>x.id===line.id?{...x,ownThermos:e.target.checked}:x))}/>
            Termo propio · −$5 en la bebida
          </label>}
          <button type="button" className="button" onClick={()=>setLines(old=>old.filter(x=>x.id!==line.id))}>Quitar</button>
        </div>
      )}
      <h2>2. Elegir operación especial</h2>
      <label>Beneficio
        <select value={kind} onChange={e=>changeKind(e.target.value as BenefitKind)}>
          <option value="NONE">Sin beneficio adicional</option>
          <option value="STAFF_FREE">Personal · 1 bebida de cortesía por turno</option>
          <option value="STAFF_10">Personal · 10% en bebida adicional</option>
          <option value="POINTS">Cliente · canjear puntos</option>
          <option value="MANUAL_FIXED">Descuento autorizado · pesos</option>
          <option value="MANUAL_PERCENT">Descuento autorizado · porcentaje</option>
        </select>
      </label>
      {kind!=="NONE"&&<>
        {discountEligible&&<label>Alcance
          <select value={scope} onChange={e=>setScope(e.target.value as Scope)}>
            <option value="LINE">Solo una bebida / producto</option>
            <option value="TICKET">Cuenta completa</option>
          </select>
        </label>}
        {scope==="LINE"&&<label>Producto al que se aplica
          <select value={lineId} onChange={e=>setLineId(e.target.value)}>
            <option value="">Selecciona producto…</option>
            {lines.map(x=><option key={x.id} value={x.id}>{x.name} · {mxn(x.basePrice+x.extras)}</option>)}
          </select>
        </label>}
        {kind==="STAFF_FREE"&&<label style={{display:"flex",gap:8,alignItems:"center"}}>
          <input type="checkbox" checked={staffFreeUsed} onChange={e=>setStaffFreeUsed(e.target.checked)}/>
          Simular que ya utilizó su cortesía del turno
        </label>}
        {kind==="STAFF_10"&&<p className="muted">10% del precio base de una bebida adicional; extras se cobran aparte. En LIVE deberá verificarse a qué colaboradora pertenece.</p>}
        {kind==="POINTS"&&<>
          <label>Cliente registrado
            <select value={customerId} onChange={e=>setCustomerId(e.target.value)}>
              <option value="">Selecciona cliente…</option>
              {customers.map(x=><option key={x.id} value={x.id}>{x.name} · {x.pointsBalance.toFixed(2)} pts</option>)}
            </select>
          </label>
          <p className="muted">Saldo en OPS: {selectedCustomer?selectedCustomer.pointsBalance.toFixed(2)+" pts":"sin cliente"}</p>
          <label>Conversión pendiente de confirmar (MXN por punto)
            <input type="number" min=".01" step=".01" placeholder="Pendiente de aprobación"
              value={rate} onChange={e=>setRate(e.target.value)}/>
          </label>
        </>}
        {(kind==="POINTS"||kind==="MANUAL_FIXED"||kind==="MANUAL_PERCENT")&&
          <label>{kind==="POINTS"?"Puntos a usar":kind==="MANUAL_PERCENT"?"Porcentaje":"Descuento (MXN)"}
            <input type="number" min="0" max={kind==="MANUAL_PERCENT"?100:undefined} step=".01"
              value={value} onChange={e=>setValue(e.target.value)}/>
          </label>}
        {(kind==="MANUAL_FIXED"||kind==="MANUAL_PERCENT")&&<label>Motivo de descuento (obligatorio)
          <input type="text" maxLength={150} value={reason} onChange={e=>setReason(e.target.value)}
            placeholder="Ej. compensación por error de servicio"/>
        </label>}
      </>}
    </section>
    <section className="card stack">
      <p className="eyebrow">PREVIEW · SIN EFECTO EN CAJA, VENTAS NI INVENTARIO</p>
      <h2>Resultado de la operación</h2>
      <div className="stack">
        {result.perLine.map(line=><div key={line.id} style={{display:"flex",justifyContent:"space-between",gap:10}}>
          <span>{line.name}{line.thermosDiscount>0?" · termo":""}</span>
          <strong>{mxn(line.amount-line.benefitDiscount)}</strong>
        </div>)}
      </div>
      <hr/>
      <div style={{display:"flex",justifyContent:"space-between"}}><span>Precio de lista</span><strong>{mxn(result.subtotal)}</strong></div>
      <div style={{display:"flex",justifyContent:"space-between"}}><span>Descuento por termo</span><strong>−{mxn(result.thermosSavings)}</strong></div>
      <div style={{display:"flex",justifyContent:"space-between"}}><span>Otro descuento</span><strong>−{mxn(result.ordinaryDiscount)}</strong></div>
      <div style={{display:"flex",justifyContent:"space-between"}}><span>Puntos aplicados</span><strong>−{mxn(result.redeemedValue)}</strong></div>
      <div className="pos-total"><strong>Total simulado a pagar</strong><strong>{mxn(result.due)}</strong></div>
      <p className="muted">Puntos utilizados: {result.redeemedPoints.toFixed(2)} · Puntos estimados nuevos: +{result.earnablePoints.toFixed(2)} (hipótesis: 5% del importe pagado).</p>
      {result.warnings.map((warning,i)=><p key={i} className="status-warn" role="alert">{warning}</p>)}
      <p className="status-warn">Este módulo no registra descuentos, cortesías, canjes, movimientos de puntos ni ventas. Faltan autorización por rol, comprobación del turno y escritura/reversa atómica en PostgreSQL antes de permitir su uso en LIVE.</p>
    </section>
  </div>;
}
