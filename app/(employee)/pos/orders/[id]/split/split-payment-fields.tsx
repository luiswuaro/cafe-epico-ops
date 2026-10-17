"use client";

import {useState} from "react";

type PaymentMethod="CASH"|"CARD"|"TRANSFER";
type CustomerOption={id:string;name:string;pointsBalance:string|number};
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
const cents=(amount:number)=>Math.round(amount*100);
const safePoints=(value:string)=>value.trim()!==""&&Number.isFinite(Number(value))
  ?Math.round(Number(value)*100):0;

export function SplitPaymentFields({total,cashOpen,live,customers=[],defaultCustomerId=null}:{
  total:number;cashOpen:boolean;live:boolean;
  customers?:CustomerOption[];defaultCustomerId?:string|null;
}){
  const [method,setMethod]=useState<PaymentMethod>(cashOpen?"CASH":"CARD");
  const [customerId,setCustomerId]=useState(defaultCustomerId??"");
  const [redeem,setRedeem]=useState("0.00");
  const [tendered,setTendered]=useState(total.toFixed(2));
  const priceCents=cents(total);
  const selected=customers.find(c=>c.id===customerId);
  const availableCents=Math.max(0,cents(Number(selected?.pointsBalance??0)));
  const enteredCents=safePoints(redeem);
  const validRedeem=enteredCents>=0&&enteredCents<=Math.min(priceCents,availableCents)
    &&/^(?:\d+)(?:\.\d{0,2})?$/.test(redeem.trim());
  const appliedCents=validRedeem&&customerId?enteredCents:0;
  const dueCents=priceCents-appliedCents;
  const pointsOnly=live&&customerId!==""&&dueCents===0&&priceCents>0;
  const effectiveMethod=pointsOnly?"POINTS":method;
  const received=tendered.trim()===""?null:safePoints(tendered);
  const change=received===null||!Number.isFinite(received)?null:received-dueCents;

  return <>
    {live&&<>
      <label>Cliente de esta cuenta
        <select name="customerId" value={customerId} onChange={event=>{
          setCustomerId(event.target.value);
          setRedeem("0.00");
          setTendered(total.toFixed(2));
        }}>
          <option value="">Sin cliente · no ganar ni canjear puntos</option>
          {customers.map(c=><option key={c.id} value={c.id}>
            {c.name} · {Number(c.pointsBalance).toFixed(2)} pts
          </option>)}
        </select>
      </label>
      {customerId&&<>
        <label>Canjear puntos (1 punto = $1)
          <input type="number" name="redeemPoints" min="0" step="0.01"
            max={(Math.min(priceCents,availableCents)/100).toFixed(2)}
            inputMode="decimal" value={redeem}
            onChange={event=>{
              setRedeem(event.target.value);
              const requested=safePoints(event.target.value);
              if(requested>=0&&requested<=Math.min(priceCents,availableCents))
                setTendered(((priceCents-requested)/100).toFixed(2));
            }} required/>
        </label>
        <p className="muted">Saldo disponible: {money.format(availableCents/100)}</p>
        {!validRedeem&&<p role="alert" className="status-bad">
          El canje debe ser positivo o cero, con hasta dos decimales y sin superar el saldo disponible.
        </p>}
      </>}
      {!customerId&&<input type="hidden" name="redeemPoints" value="0"/>}
      <p className="muted">Total de esta cuenta: {money.format(total)} ·
        Puntos: {money.format(appliedCents/100)} ·
        <strong> Saldo por cobrar: {money.format(dueCents/100)}</strong></p>
    </>}
    <input type="hidden" name="paymentMethod" value={effectiveMethod}/>
    {pointsOnly?
      <p className="muted">Esta cuenta quedará pagada íntegramente con puntos. No se registra entrada de efectivo ni cobro bancario.</p>
      :<>
        <label>Método para el saldo pendiente
          <select value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}>
            <option value="CASH" disabled={!cashOpen}>Efectivo{cashOpen?"":" · abre caja"}</option>
            <option value="CARD">Tarjeta</option>
            <option value="TRANSFER">Transferencia</option>
          </select>
        </label>
        {live&&method==="CASH" ? <>
          <label>Efectivo recibido
            <input type="number" name="tenderedAmount" step="0.01"
              min={(dueCents/100).toFixed(2)}
              inputMode="decimal" value={tendered}
              onChange={event=>setTendered(event.target.value)} required/>
          </label>
          <p className="muted">Cambio a entregar: <strong>
            {change!==null&&change>=0?money.format(change/100):"Ingresa efectivo suficiente"}
          </strong></p>
        </> :<input type="hidden" name="tenderedAmount" value=""/>}
        {live&&method!=="CASH"&&
          <p className="muted">Confirma el depósito o cobro en terminal antes de registrar el pago.</p>}
      </>
    }
    {pointsOnly&&<input type="hidden" name="tenderedAmount" value=""/>}
  </>;
}
