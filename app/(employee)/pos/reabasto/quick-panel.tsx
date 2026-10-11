"use client";
import {useEffect,useState} from "react";
import {getQuickReplenishment} from "./quick-actions";
type Queue=Awaited<ReturnType<typeof getQuickReplenishment>>;
export function ReabastoQuickPanel({label="Insumos"}:{label?:string}){
 const [open,setOpen]=useState(false);
 const [status,setStatus]=useState("");
 const [data,setData]=useState<Queue|null>(null);
 useEffect(()=>{
  if(!open)return;
  const handler=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};
  document.addEventListener("keydown",handler);
  return ()=>document.removeEventListener("keydown",handler);
 },[open]);
 async function show(){
  setOpen(true);
  setStatus("Revisando saldos de Inventario OPS…");
  try{setData(await getQuickReplenishment());setStatus("");}
  catch(error){setStatus(error instanceof Error?error.message:"Sin conexión con inventario");}
 }
 return <>
  <button type="button" className="pos-fast-all pos-quick-reabasto-trigger" onClick={()=>void show()}>
    {label} <span aria-hidden="true">↗</span>
  </button>
  {open&&<div className="pos-quick-reabasto-backdrop" role="presentation" onMouseDown={event=>{
    if(event.target===event.currentTarget)setOpen(false);
  }}>
    <section role="dialog" aria-modal="true" aria-label="Reabasto rápido" className="pos-quick-reabasto-dialog">
      <header><div><p className="eyebrow">OPS · INVENTARIO</p><h2>Reabasto rápido</h2></div>
        <button className="button" type="button" onClick={()=>setOpen(false)}>Cerrar ✕</button></header>
      <p className="muted">Consulta sin salir del pedido. El stock negativo no impide vender.</p>
      {status&&<p role="status" className="muted">{status}</p>}
      {data&&<>
        <p><strong>{data.total}</strong> insumo(s) para revisar.</p>
        <div className="pos-quick-reabasto-items">
          {data.alerts.map(item=><div key={item.id}>
            <div><strong>{item.name}</strong>
              <small>{item.severity==="AGOTADO"?"Sin saldo / negativo":
                item.severity==="SIN_CONTEO"?"Sin conteo":
                item.severity==="BAJO_MINIMO"?"Bajo mínimo":"Pocas porciones"}</small></div>
            <strong>{item.balance===null?"?":
              new Intl.NumberFormat("es-MX",{maximumFractionDigits:3}).format(item.balance)} {item.unit}</strong>
          </div>)}
          {data.alerts.length===0&&<p className="muted">No hay alertas por ahora.</p>}
        </div>
        {data.total>18&&<small className="muted">Mostrando los 18 insumos más urgentes.</small>}
      </>}
      <footer><button type="button" className="button" onClick={()=>void show()}>
        Actualizar saldos</button>
        <a className="button" href="/pos/reabasto">Ver inventario detallado</a></footer>
    </section>
  </div>}
 </>;
}
