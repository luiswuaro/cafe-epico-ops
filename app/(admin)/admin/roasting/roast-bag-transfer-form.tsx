"use client";
import {useState} from "react";
import {transferRoastedBagToHopper} from "./inventory-actions";
import {transferProjection} from "@/src/domain/roasting/stock-ledger";

const fmt=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});
export function RoastBagTransferForm({
  lotId,bagG,barG,previewPendingG,preview,canTransfer,operationId,
}:{
  lotId:string;bagG:number;barG:number;previewPendingG:number;
  preview:boolean;canTransfer:boolean;operationId:string;
}){
  const [amount,setAmount]=useState("");
  const [showProjection,setShowProjection]=useState(true);
  const stockForDisplay=preview?bagG+previewPendingG:bagG;
  let projection:{quantityG:number;bagAfterG:number;barAfterG:number}|null=null;
  let problem="";
  if(amount.trim()){
    try{projection=transferProjection(stockForDisplay,barG,amount);}
    catch(error){problem=error instanceof Error?error.message:"Cantidad inválida";}
  }
  const possible=canTransfer&&projection!==null&&!preview;
  return <form className="stack" action={transferRoastedBagToHopper}>
    <input type="hidden" name="lotId" value={lotId}/>
    <input type="hidden" name="operationId" value={operationId}/>
    <label>
      <strong>Gramos a enviar a tolva</strong>
      <input name="quantityG" type="number" inputMode="decimal"
        min="0.001" step="0.001" max={stockForDisplay||undefined}
        placeholder="Ej. 342" value={amount}
        onChange={e=>setAmount(e.target.value)} required/>
    </label>
    <label>Nota opcional
      <input name="note" maxLength={300} placeholder="Recarga tolva, apertura, hora..."/>
    </label>
    <div className="task">
      <div style={{flex:1}}>
        <strong>Bolsa · Almacén seco</strong>
        <p className="muted">Antes: {fmt.format(stockForDisplay)} g</p>
        <strong>Barra · Insumo espresso</strong>
        <p className="muted">Antes: {fmt.format(barG)} g (se conserva)</p>
      </div>
      <button type="button" className="button button-secondary" onClick={()=>setShowProjection(!showProjection)}>
        {showProjection?"Ocultar cálculo":"Ver cálculo"}
      </button>
    </div>
    {showProjection&&projection&&<div className="card" aria-live="polite">
      <p><strong>Después del traslado de {fmt.format(projection.quantityG)} g:</strong></p>
      <p>Bolsa: <strong>{fmt.format(projection.bagAfterG)} g</strong></p>
      <p>Tolva: <strong>{fmt.format(projection.barAfterG)} g</strong></p>
      {preview&&<p className="muted">Simulación visual: incorpora la producción pendiente del día; no modifica existencias reales.</p>}
    </div>}
    {problem&&<p className="status-warn" role="alert">{problem}</p>}
    {!canTransfer&&!preview&&<p className="status-warn">
      Primero registra el café tostado del lote en almacén.
    </p>}
    <button type="submit" disabled={!possible}>
      {preview?"Enviar a tolva · solo disponible en producción":"Confirmar traslado a tolva"}
    </button>
    {preview&&<p className="muted">
      Preview protegido: los botones de contabilización están deshabilitados porque el preview y producción comparten la misma base de datos.
    </p>}
  </form>;
}
