"use client";

import {useState} from "react";
import {payLiveCommand} from "../actions";
type Method="CASH"|"CARD"|"TRANSFER";
const money=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
export function CheckoutPaymentForm({orderId,total,cashOpen,canOverrideStock,partialPaid}:{
  orderId:string;total:number;cashOpen:boolean;canOverrideStock:boolean;partialPaid:boolean;
}){
  const [method,setMethod]=useState<Method>(cashOpen?"CASH":"CARD");
  const [tendered,setTendered]=useState(total.toFixed(2));
  const [allowShortage,setAllowShortage]=useState(false);
  const change=Number(tendered)-total;
  return <section className="card stack">
    <p className="eyebrow">COBRAR CUENTA · {money.format(total)}</p>
    {partialPaid?<div className="stack">
      <p className="status-warn">La mesa tiene cobros parciales. Continúa desde Dividir cuenta.</p>
      <a className="button" href={"/pos/orders/"+orderId+"/split"}>Ir a cuentas divididas</a>
    </div>:<form action={payLiveCommand} className="stack">
      <input type="hidden" name="orderId" value={orderId}/>
      <h2>¿Cómo va a pagar?</h2>
      <label>Método de pago
        <select name="paymentMethod" value={method} onChange={e=>setMethod(e.target.value as Method)}>
          <option value="CASH" disabled={!cashOpen}>Efectivo{cashOpen?"":" · abre caja"}</option>
          <option value="CARD">Tarjeta · cobro en terminal externa</option>
          <option value="TRANSFER">Transferencia · verificar depósito</option>
        </select>
      </label>
      {method==="CASH"?<>
        <label>Efectivo recibido
          <input name="tenderedAmount" type="number" min={total} step="0.01" value={tendered}
            onChange={e=>setTendered(e.target.value)} required/>
        </label>
        <p className="muted">Cambio: <strong>{tendered.trim()&&change>=0?money.format(change):"Falta efectivo"}</strong></p>
      </>:<p className="muted">Antes de registrar el pago, confirma el cobro en la terminal o banco. OPS no realiza cargos externos.</p>}
      {canOverrideStock&&<label className="stack">
        <span><input name="allowStockShortage" type="checkbox" checked={allowShortage}
          onChange={e=>setAllowShortage(e.target.checked)}/>
          {" "}Autorizar venta de producto físicamente entregado aunque exista faltante teórico
        </span>
        <small className="muted">Sólo propietario. Se descontará el inventario incluso si queda negativo, se registrará auditoría y requerirá conteo.</small>
      </label>}
      <button type="submit" className="pos-pay-button" disabled={method==="CASH"&&(!tendered.trim()||change<0)}>
        Confirmar cobro · {money.format(total)}
      </button>
    </form>}
  </section>;
}
