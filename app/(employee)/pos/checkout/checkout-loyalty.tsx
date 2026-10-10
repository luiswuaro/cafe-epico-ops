"use client";

import {useActionState,useEffect,useState} from "react";
import {registerCheckoutCustomer,type CheckoutCustomerResult} from "./customer-action";
import {calculateEarnedPointsFromRealMoney} from "@/src/domain/pos/benefits-preview";

export type CheckoutCustomer={id:string;name:string;pointsBalance:number};
const money=(n:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);
export function redeemAmount(value:string,balance:number,total:number){
  const parsed=Number(value);
  const valid=value.trim()!==""&&Number.isFinite(parsed)&&parsed>=0&&
    Math.round(parsed*100)===parsed*100&&parsed<=balance&&parsed<=total;
  const points=valid?Math.round(parsed*100)/100:0;
  return {points,valid,remaining:Math.round((total-points)*100)/100};
}

export function CheckoutLoyalty({
  customers,selectedId,onSelect,redeemPoints,onRedeemChange,total,liveEnabled,
}:{
  customers:CheckoutCustomer[];selectedId:string;
  onSelect:(id:string,created?:CheckoutCustomer)=>void;
  redeemPoints:string;onRedeemChange:(value:string)=>void;
  total:number;liveEnabled:boolean;
}){
  const [search,setSearch]=useState("");
  const [registration,registrationAction,registrationPending]=useActionState(
    registerCheckoutCustomer,{error:null,customer:null} as CheckoutCustomerResult,
  );
  useEffect(()=>{
    if(registration.customer && registration.customer.id!==selectedId){
      onSelect(registration.customer.id,registration.customer);
    }
  },[registration.customer,selectedId,onSelect]);
  const customer=customers.find(x=>x.id===selectedId)??registration.customer;
  const pointsBalance=customer?.pointsBalance??0;
  const {points,valid,remaining}=redeemAmount(redeemPoints,pointsBalance,total);
  const visible=customers.filter(x=>x.id===selectedId||x.name.toLocaleLowerCase("es-MX")
    .includes(search.toLocaleLowerCase("es-MX"))).slice(0,180);
  function simulateCreate(form:FormData){
    const name=String(form.get("name")??"").trim();
    if(name.length<2)return;
    onSelect(crypto.randomUUID(),{id:crypto.randomUUID(),name,pointsBalance:0});
  }
  const fields=<>
    <label>Nombre del cliente
      <input name="name" required minLength={2} maxLength={100} placeholder="Nombre y apellido"/>
    </label>
    <label>Teléfono (opcional)
      <input name="phone" inputMode="tel" maxLength={30} placeholder="Para encontrarlo en la próxima compra"/>
    </label>
    <button type="submit" className="button" disabled={registrationPending}>
      {registrationPending?"Guardando…":"Registrar y seleccionar"}
    </button>
  </>;
  return <section className="card stack" aria-label="Cliente y canje de puntos"
    style={{padding:16,gap:12}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
      <strong>Cliente y puntos</strong>
      <small className="muted">1 punto = $1 · +5% sobre dinero pagado</small>
    </div>
    <label>Buscar cliente
      <input type="search" value={search} placeholder="Nombre del cliente"
        onChange={e=>setSearch(e.target.value)}/>
    </label>
    <label>Seleccionar cliente
      <select value={selectedId}
        onChange={e=>{onSelect(e.target.value);onRedeemChange("0");}}>
        <option value="">Sin cliente · cobro normal</option>
        {visible.map(x=><option key={x.id} value={x.id}>
          {x.name} · {x.pointsBalance.toFixed(2)} pts
        </option>)}
        {customer&&!visible.some(x=>x.id===customer.id)&&
          <option value={customer.id}>{customer.name} · {customer.pointsBalance.toFixed(2)} pts</option>}
      </select>
    </label>
    <details>
      <summary style={{cursor:"pointer",fontWeight:600}}>＋ Registrar cliente nuevo aquí</summary>
      {liveEnabled
        ?<form action={registrationAction} className="stack" style={{paddingTop:12}}>{fields}</form>
        :<form action={simulateCreate} className="stack" style={{paddingTop:12}}>
          {fields}
          <small className="muted">Alta simulada: este cliente no se guarda en OPS.</small>
        </form>}
      {registration.error&&<p className="status-bad" role="alert">{registration.error}</p>}
    </details>
    {customer?<div className="stack" style={{gap:10}}>
      <div className="row" style={{display:"flex",justifyContent:"space-between",gap:8}}>
        <span>Saldo disponible</span><strong>{money(pointsBalance)} · {pointsBalance.toFixed(2)} pts</strong>
      </div>
      <label>Puntos a canjear en este cobro
        <input type="number" inputMode="decimal" min={0}
          max={Math.min(total,pointsBalance).toFixed(2)} step=".01"
          value={redeemPoints} onChange={e=>onRedeemChange(e.target.value)}/>
      </label>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" className="button" onClick={()=>onRedeemChange("0")}>No canjear</button>
        <button type="button" className="button"
          disabled={pointsBalance<=0||total<=0}
          onClick={()=>onRedeemChange(Math.min(total,pointsBalance).toFixed(2))}>
          Usar máximo disponible
        </button>
      </div>
      {!valid&&<p className="status-bad" role="alert">Revisa el canje: no puede superar el saldo o total, ni tener más de dos decimales.</p>}
      <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
        <span>Puntos canjeados</span><strong>−{money(points)}</strong>
      </div>
      <div className="pos-total" style={{display:"flex",justifyContent:"space-between",gap:8}}>
        <strong>A cobrar con dinero</strong><strong>{money(remaining)}</strong>
      </div>
      <p className="muted">Puntos nuevos: <strong>+{calculateEarnedPointsFromRealMoney(remaining).toFixed(2)} pts</strong> (5% de lo cobrado realmente).</p>
    </div>:<p className="muted">Puedes cobrar sin cliente o seleccionarlo para usar sus puntos.</p>}
  </section>;
}
