import Link from "next/link";
import {unlockPosHistory} from "@/src/application/pos/history-access-actions";
import type {HistoryPath} from "@/src/application/pos/history-access";

export function HistoryLock({destination,error}:{
 destination:HistoryPath;error?:string|null;
}){
 const cash=destination==="/pos/cash/history";
 return <main className="shell pos-shell">
  <section className="hero pos-hero">
    <p className="eyebrow">CAFÉ ÉPICO · ACCESO CONTROLADO</p>
    <h1>{cash?"Historial de cajas":"Historial de tickets"}</h1>
    <p className="muted">El historial está restringido a propietarios.
      Solicita una clave temporal al encargado para consultar estos registros.</p>
    <Link href={cash?"/pos/cash":"/pos"} className="button">← Volver</Link>
  </section>
  <section className="card stack">
   <h2>Acceso con clave</h2>
   <p>El propietario genera una clave de 8 dígitos desde <strong>Administración → Acceso a historiales</strong>.
     Es de un solo uso y habilita ambas consultas durante 15 minutos en este navegador.</p>
   {error==="invalid"&&<p role="alert" className="status-bad">Clave incorrecta, vencida o ya utilizada.</p>}
   {error==="rate"&&<p role="alert" className="status-bad">Demasiados intentos. Espera 15 minutos o solicita apoyo a un administrador.</p>}
   <form action={unlockPosHistory} className="stack">
    <input name="destination" type="hidden" value={destination}/>
    <label>Clave temporal
     <input name="code" type="password" inputMode="numeric"
       minLength={8} maxLength={8} pattern="[0-9]{8}" autoComplete="off"
       placeholder="8 dígitos" required/>
    </label>
    <button type="submit">Autorizar consulta</button>
   </form>
  </section>
 </main>;
}