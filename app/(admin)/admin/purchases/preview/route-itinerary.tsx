"use client";
import {useEffect,useMemo,useState} from "react";
import type {VendorProfile,RouteStop} from "@/src/domain/purchases/route-schedule";
import {evaluateRoute,reorderByClosingTime,clock} from "@/src/domain/purchases/route-schedule";
export function RouteItinerary({vendors,tripDate}:{vendors:VendorProfile[];tripDate:string}){
 const [stops,setStops]=useState<RouteStop[]>([]);
 const [selected,setSelected]=useState("");
 const [depart,setDepart]=useState("07:00");
 const [notice,setNotice]=useState("");
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>{
  try{const saved=JSON.parse(localStorage.getItem("epico-preview-itinerario-v1")||"null");
   if(saved&&Array.isArray(saved.stops))setStops(saved.stops.filter((x:RouteStop)=>
    x&&typeof x.id==="string"&&typeof x.vendorId==="string").slice(0,30));
   if(typeof saved?.depart==="string")setDepart(saved.depart);
  }catch{}
  setHydrated(true);
 },[]);
 useEffect(()=>{if(!hydrated)return;
   try{localStorage.setItem("epico-preview-itinerario-v1",JSON.stringify({stops,depart}));}catch{}
 },[stops,depart,hydrated]);
 const result=useMemo(()=>evaluateRoute(stops,vendors,tripDate,depart),[stops,vendors,tripDate,depart]);
 const patch=(id:string,values:Partial<RouteStop>)=>
  setStops(s=>s.map(x=>x.id===id?{...x,...values}:x));
 const changeOrder=(i:number,dir:number)=>{
  setStops(s=>{const a=s.map(x=>({...x,legMinutes:""})),j=i+dir;
   if(j<0||j>=a.length)return s;
   [a[i],a[j]]=[a[j],a[i]];return a;});
  setNotice("Ruta cambiada: vuelve a introducir tiempos de traslado de cada tramo.");
 };
 const addressList=stops.map(s=>vendors.find(v=>v.id===s.vendorId)?.address||"");
 const mapUrl=addressList.length>0&&addressList.every(Boolean)?
  "https://www.google.com/maps/dir/?"+new URLSearchParams({
   api:"1",origin:"Tepexi de Rodríguez, Puebla, México",
   destination:"Tepexi de Rodríguez, Puebla, México",
   waypoints:addressList.join("|"),travelmode:"driving"}).toString():"";
 const textRoute=()=>{
  return ["CAFÉ ÉPICO · ITINERARIO PRELIMINAR",tripDate+" Salida: "+depart,
   ...result.steps.map((s,i)=>(i+1)+". "+s.vendor.name+
   " llegada "+clock(s.arrival)+" espera "+(s.wait??"?")+" min"+
   " atención "+clock(s.start)+" salida "+clock(s.departure)+
   " · "+(s.issue||"Datos de horario capturados; confirmar antes de salir")),
   "Regreso pendiente de tiempo y tráfico reales."].join("\n");
 };
 return <section className="abp-panel">
  <h2>Secuencia de tiendas por hora y apertura</h2>
  <p className="abp-lead">La ruta ordena paradas y calcula espera por apertura,
   tiempo de compra y posible llegada después del cierre. Los tiempos de carretera se introducen
   manualmente; no existe conexión a tráfico en tiempo real en esta preview.</p>
  <div className="abp-fields cols-3">
   <label>Salida de Café Épico<input type="time" value={depart} onChange={e=>setDepart(e.target.value)}/></label>
   <label>Añadir parada<select value={selected} onChange={e=>setSelected(e.target.value)}>
    <option value="">Selecciona una sucursal…</option>
    {vendors.filter(v=>v.name).map(v=><option key={v.id} value={v.id}>{v.name} · {v.postal||"sin CP"}</option>)}
    </select></label>
   <div className="abp-actions" style={{alignSelf:"end"}}>
    <button type="button" className="abp-button" disabled={!selected}
     onClick={()=>{setStops(s=>[...s,{id:crypto.randomUUID(),vendorId:selected,
      legMinutes:"",visitMinutes:"20"}]);setSelected("");}}>+ Parada</button>
   </div>
  </div>
  <div className="abp-actions">
   <button type="button" className="abp-button" disabled={stops.length<2}
    onClick={()=>{setStops(s=>reorderByClosingTime(s,vendors));
     setNotice("Sugerencia de cierres más tempranos (NO optimiza kilómetros). Introduce tiempos por tramo.");}}>
    Sugerir orden por cierres</button>
   <button type="button" className="abp-button"
    onClick={()=>{void navigator.clipboard.writeText(textRoute()).then(()=>setNotice("Itinerario copiado.")).catch(()=>setNotice("No se pudo copiar."));}}>
    Copiar itinerario</button>
   {mapUrl&&<a className="abp-button primary" target="_blank" rel="noopener noreferrer" href={mapUrl}>
    Abrir ruta en Google Maps ↗</a>}
  </div>
  {notice&&<p className="abp-warning" role="status">{notice}</p>}
  <div className="abp-summary">
   <strong>Inicio: Café Épico / Tepexi · {tripDate||"sin fecha"} {depart}</strong>
   <span>{result.steps.length} paradas · {result.warnings} observación(es)
    · última salida calculable: {clock(result.endTime)}</span>
  </div>
  <div className="abp-list">{result.steps.map((s,i)=><div className="abp-route-stop" key={s.stop.id}>
    <div className="abp-inline" style={{justifyContent:"space-between"}}>
     <strong>{i+1}. {s.vendor.name}</strong>
     <div className="abp-actions">
      <button type="button" className="abp-button" disabled={i===0}
       onClick={()=>changeOrder(i,-1)} aria-label={"Subir "+s.vendor.name}>↑</button>
      <button type="button" className="abp-button" disabled={i===stops.length-1}
       onClick={()=>changeOrder(i,1)} aria-label={"Bajar "+s.vendor.name}>↓</button>
      <button type="button" className="abp-button"
       onClick={()=>setStops(x=>x.filter(t=>t.id!==s.stop.id))}>Quitar</button>
     </div>
    </div>
    <p className="abp-foot">{s.vendor.address||"Dirección sin definir"} ·
      {s.vendor.opening&&s.vendor.closing
       ?"Horario capturado "+s.vendor.opening+"–"+s.vendor.closing:"Horario desconocido"}</p>
    <div className="abp-fields cols-2">
     <label>Traslado desde punto anterior (min)
      <input type="number" min="0" step="1" value={s.stop.legMinutes}
       onChange={e=>patch(s.stop.id,{legMinutes:e.target.value})}
       placeholder="Consulta Maps"/></label>
     <label>Tiempo de compra (min)
      <input type="number" min="0" step="1" value={s.stop.visitMinutes}
       onChange={e=>patch(s.stop.id,{visitMinutes:e.target.value})}/></label>
    </div>
    <div className="abp-route-times">
     <span>Llegada <strong>{clock(s.arrival)}</strong></span>
     <span>Atención <strong>{clock(s.start)}</strong></span>
     <span>Salida <strong>{clock(s.departure)}</strong></span>
     {s.wait!==null&&s.wait>0&&<span>Espera <strong>{s.wait} min</strong></span>}
    </div>
    {s.issue&&<p className="abp-route-warning">{s.issue}</p>}
   </div>)}
   {stops.length===0&&<p className="abp-muted">Agrega paradas. Primero configura los horarios en «Proveedores».</p>}
  </div>
  <p className="abp-foot">El cálculo no incluye el regreso hasta Tepexi. La sugerencia por
   horario no sustituye optimización geográfica; confirmar aperturas y tráfico antes de salir.</p>
 </section>;
}
