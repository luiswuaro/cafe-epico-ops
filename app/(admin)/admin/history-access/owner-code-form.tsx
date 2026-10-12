"use client";

import {useActionState} from "react";
import {createOwnerHistoryCode,type HistoryCodeState} from "@/src/application/pos/history-access-actions";
const initial:HistoryCodeState={code:null,expiresAt:null,error:null};
export function OwnerHistoryCodeForm(){
 const [state,action,pending]=useActionState(createOwnerHistoryCode,initial);
 return <section className="card stack">
  <h2>Emitir clave para un trabajador</h2>
  <p>La clave sirve una vez, caduca 5 minutos después de generarla y autoriza
   consultar el historial de caja y tickets durante 15 minutos en el dispositivo
   del empleado que la ingrese.</p>
  <form action={action}>
   <button type="submit" disabled={pending}>{pending?"Generando…":"Generar nueva clave de acceso"}</button>
  </form>
  {state.error&&<p className="status-bad" role="alert">{state.error}</p>}
  {state.code&&<div className="stack" role="status">
    <span className="eyebrow">CLAVE TEMPORAL · COMPÁRTELA ÚNICAMENTE CON EL TRABAJADOR AUTORIZADO</span>
    <strong style={{fontSize:"2rem",letterSpacing:".3em",fontVariantNumeric:"tabular-nums"}}>{state.code}</strong>
    <p className="muted">Vence: {state.expiresAt?new Date(state.expiresAt).toLocaleTimeString("es-MX",{
      timeZone:"America/Mexico_City",hour:"2-digit",minute:"2-digit"}):"en 5 minutos"}.
      No queda almacenada en texto visible en la base de datos.</p>
    <p className="muted">Cierra esta pantalla cuando termines de compartirla.</p>
   </div>}
 </section>;
}