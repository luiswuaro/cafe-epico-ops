import Link from "next/link";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getOpsReplenishmentQueue} from "@/src/application/pos/replenishment";
import {ReplenishmentCopy} from "./replenishment-copy";

export const dynamic="force-dynamic";
const qty=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});
const statusText={
 SIN_CONTEO:"Verificar conteo",AGOTADO:"Sin saldo / negativo",
 BAJO_MINIMO:"Bajo mínimo",POCAS_PORCIONES:"Pocas porciones",OK:"Con cobertura",
};
export default async function ReplenishmentPage(){
 const {employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sin sucursal.");
 await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
 const queue=await getOpsReplenishmentQueue(employee.organizationId,employee.homeStoreId);
 const lines=queue.alerts.map(item=>{
   const balance=item.balance===null?"SIN CONTEO":qty.format(item.balance)+" "+item.unit;
   const toMinimum=item.deficitToMinimum===null?"":", hasta mínimo +"+qty.format(item.deficitToMinimum)+" "+item.unit;
   return statusText[item.severity]+" | "+item.name+" | "+balance+toMinimum;
 });
 return <main className="shell pos-shell pos-replenishment">
   <header className="hero pos-hero">
     <div><p className="eyebrow">OPERACIÓN · INSUMOS OPS</p>
       <h1>Reabasto rápido</h1>
       <p className="muted">Ordenado por urgencia. No bloquea cobros. Datos del inventario
       oficial OPS y de las recetas vigentes; sin saldos de Loyverse.</p>
     </div>
     <div className="pos-result-actions">
       <Link className="button" href="/pos">Volver al POS</Link>
       <Link className="button" href="/pos/orders">Comandas</Link>
       <Link className="button" href="/inventory/ops">Inventario OPS</Link>
     </div>
   </header>
   {process.env.VERCEL_ENV==="preview"&&<p className="card status-warn" role="status">
     Preview de solo lectura. No hagas compras o movimientos de prueba en la base real.
   </p>}
   <section className="pos-replenishment-kpis">
     <article className="card"><p className="eyebrow">Revisar ahora</p>
       <strong className="metric">{queue.alerts.length}</strong>
       <small className="muted">Insumos de recetas activas con alerta</small></article>
     <article className="card"><p className="eyebrow">Sin conteo</p>
       <strong className="metric">{queue.uncounted}</strong>
       <small className="muted">Falta confirmar existencia teórica</small></article>
     <article className="card"><p className="eyebrow">Sin mínimo definido</p>
       <strong className="metric">{queue.missingMinimum}</strong>
       <small className="muted">Define mínimos cuando tengas consumo real</small></article>
   </section>
   <p className="muted pos-replenishment-method">
     «Pocas porciones» significa hasta {queue.fewPortionsThreshold} preparaciones hipotéticas
     del producto que más utiliza ese ingrediente en una receta.
     No es un pronóstico de demanda ni implica que todas las bebidas puedan fabricarse
     simultáneamente; el conteo físico prevalece.
   </p>
   {queue.alerts.length>0&&<ReplenishmentCopy content={
     "CAFÉ ÉPICO · REVISAR REABASTO\n"+lines.join("\n")
   }/>}
   {queue.alerts.length===0?<section className="card"><h2>Sin alertas por ahora</h2>
     <p>Todos los insumos de recetas activas tienen saldo o cobertura por encima de
       los criterios de esta vista. Consulta inventario para revisar el conteo físico.</p>
   </section>:<section className="pos-replenishment-list" aria-label="Insumos por revisar">
     {queue.alerts.map(item=><article className="card pos-replenishment-item" key={item.id}>
       <div className="pos-replenishment-top">
         <div><span className={"pos-replenishment-state pos-replenishment-state-"+item.severity}>
           {statusText[item.severity]}</span><h2>{item.name}</h2></div>
         <strong className="pos-replenishment-stock">
           {item.balance===null?"SIN CONTEO":qty.format(item.balance)+" "+item.unit}
         </strong>
       </div>
       <div className="pos-replenishment-bottom">
         <span>Referencia: {item.referenceProduct} · hasta
           <strong> {qty.format(item.theoreticalPortions??0)} porciones</strong>
           {item.balance===null?" (cobertura desconocida)":""}
         </span>
         <span>{item.minimum===null?"Mínimo no definido":
           "Mínimo "+qty.format(item.minimum)+" "+item.unit+
           (item.deficitToMinimum!==null&&item.deficitToMinimum>0
             ?" · faltan "+qty.format(item.deficitToMinimum)+" "+item.unit:"")}</span>
       </div>
     </article>)}
   </section>}
   <p className="muted pos-replenishment-method">Agua de preparación y hielo propio
     no aparecen porque son insumos de costo, sin inventario descontable.
     Se omiten también artículos que no participan en recetas POS activas.
     Entradas, conteos y compras se registran únicamente desde Inventario OPS.</p>
 </main>;
}
