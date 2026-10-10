"use client";

import {useCallback,useState} from "react";
import {payLiveCommand} from "../actions";
import {CheckoutLoyalty,redeemAmount,type CheckoutCustomer} from "./checkout-loyalty";

type Method="CASH"|"CARD"|"TRANSFER";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});

export function CheckoutPaymentForm({
  orderId,total,cashOpen,canOverrideStock,partialPaid,customers,initialCustomerId,
}:{
  orderId:string;total:number;cashOpen:boolean;canOverrideStock:boolean;
  partialPaid:boolean;customers:CheckoutCustomer[];initialCustomerId:string|null;
}){
  const [method,setMethod]=useState<Method>(cashOpen?"CASH":"CARD");
  const [tendered,setTendered]=useState(total.toFixed(2));
  const [allowShortage,setAllowShortage]=useState(false);
  const [customerId,setCustomerId]=useState(initialCustomerId??"");
  const [createdCustomer,setCreatedCustomer]=useState<CheckoutCustomer|null>(null);
  const [redeemPoints,setRedeemPoints]=useState("0");
  const selectCustomer=useCallback((id:string,created?:CheckoutCustomer)=>{
    setCustomerId(id);setRedeemPoints("0");
    if(created)setCreatedCustomer(created);
  },[]);
  const balance=customers.find(c=>c.id===customerId)?.pointsBalance??
    (createdCustomer?.id===customerId?createdCustomer.pointsBalance:0);
  const {valid,points,remaining}=redeemAmount(redeemPoints,balance,total);
  const invalidCanje=!valid||(points>0&&!customerId);
  const change=Number(tendered)-remaining;
  return <section className="card stack">
    <p className="eyebrow">COBRAR CUENTA · {money.format(total)}</p>
    {partialPaid?<div className="stack">
      <p className="status-warn">La mesa tiene cobros parciales. Continúa desde Dividir cuenta.</p>
      <a className="button" href={"/pos/orders/"+orderId+"/split"}>Ir a cuentas divididas</a>
    </div>:<>
      <CheckoutLoyalty
        customers={createdCustomer
          ?[...customers.filter(c=>c.id!==createdCustomer.id),createdCustomer]:customers}
        selectedId={customerId} onSelect={selectCustomer}
        redeemPoints={redeemPoints} onRedeemChange={setRedeemPoints}
        total={total} liveEnabled={true}/>
      <form action={payLiveCommand} className="stack">
        <input type="hidden" name="orderId" value={orderId}/>
        <input type="hidden" name="customerId" value={customerId}/>
        <input type="hidden" name="redeemPoints" value={points.toFixed(2)}/>
        <input type="hidden" name="paymentMethod" value={remaining===0?"POINTS":method}/>
        <h2>{remaining===0?"Canjear y cerrar cuenta":"¿Cómo va a pagar el restante?"}</h2>
        {remaining>0?<label>Método de pago
          <select value={method} onChange={e=>setMethod(e.target.value as Method)}>
            <option value="CASH" disabled={!cashOpen}>Efectivo{cashOpen?"":" · abre caja"}</option>
            <option value="CARD">Tarjeta · cobro en terminal externa</option>
            <option value="TRANSFER">Transferencia · verificar depósito</option>
          </select>
        </label>:<p className="status-ok">El canje cubre toda la cuenta. No registres cargo en terminal ni efectivo.</p>}
        {remaining>0&&method==="CASH"?<>
          <label>Efectivo recibido
            <input name="tenderedAmount" type="number" min={remaining} step="0.01"
              value={tendered} onChange={e=>setTendered(e.target.value)} required/>
          </label>
          <p className="muted">Cambio: <strong>{tendered.trim()&&change>=0?money.format(change):"Falta efectivo"}</strong></p>
        </>:<p className="muted">{remaining>0
          ?"Antes de registrar el pago, confirma el cobro en la terminal o banco. OPS no realiza cargos externos."
          :"El servidor verificará el saldo de puntos antes de registrar la venta."}</p>}
        {canOverrideStock&&<label className="stack">
          <span><input name="allowStockShortage" type="checkbox" checked={allowShortage}
            onChange={e=>setAllowShortage(e.target.checked)}/>
            {" "}Autorizar venta de producto físicamente entregado aunque exista faltante teórico
          </span>
          <small className="muted">Solo propietario. Se registrará auditoría y requerirá conteo.</small>
        </label>}
        <button type="submit" className="pos-pay-button"
          disabled={invalidCanje||(remaining>0&&method==="CASH"&&(!tendered.trim()||change<0))}>
          {remaining===0?"Confirmar canje · "+points.toFixed(2)+" pts":
            "Confirmar cobro · "+money.format(remaining)}
        </button>
      </form>
    </>}
  </section>;
}
