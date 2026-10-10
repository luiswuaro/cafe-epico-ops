"use client";

import {useState} from "react";

type PaymentMethod="CASH"|"CARD"|"TRANSFER";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});

export function SplitPaymentFields({total,cashOpen,live}:{
  total:number;cashOpen:boolean;live:boolean;
}){
  const [method,setMethod]=useState<PaymentMethod>(cashOpen?"CASH":"CARD");
  const [tendered,setTendered]=useState(total.toFixed(2));
  const cents=tendered.trim()===""?null:Math.round(Number(tendered)*100);
  const dueCents=Math.round(total*100);
  const change=cents===null||!Number.isFinite(cents)?null:cents-dueCents;
  return <>
    <label>Método de pago
      <select name="paymentMethod" value={method}
        onChange={event=>setMethod(event.target.value as PaymentMethod)}>
        <option value="CASH" disabled={!cashOpen}>Efectivo{cashOpen?"":" · abre caja"}</option>
        <option value="CARD">Tarjeta</option>
        <option value="TRANSFER">Transferencia</option>
      </select>
    </label>
    {live&&method==="CASH" ? <>
      <label>Efectivo recibido
        <input type="number" name="tenderedAmount" step="0.01" min={total}
          inputMode="decimal" value={tendered}
          onChange={event=>setTendered(event.target.value)} required/>
      </label>
      <p className="muted">Cambio a entregar: <strong>
        {change!==null&&change>=0?money.format(change/100):"Ingresa efectivo suficiente"}
      </strong></p>
    </> : <input type="hidden" name="tenderedAmount" value=""/>}
    {live&&method!=="CASH"&&
      <p className="muted">Confirma el depósito o cobro en terminal antes de registrar el pago.</p>}
  </>;
}
