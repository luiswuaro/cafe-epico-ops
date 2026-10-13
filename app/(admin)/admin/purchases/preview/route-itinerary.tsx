"use client";
import {useEffect,useMemo,useState} from "react";
import type {VendorProfile,RouteStop} from "@/src/domain/purchases/route-schedule";
import {evaluateRoute,reorderByClosingTime,clock} from "@/src/domain/purchases/route-schedule";
export function RouteItinerary({vendors,tripDate}:{vendors:VendorProfile[];tripDate:string}){
 const [stops,setStops]=useState<RouteStop[]>([]);
 const [selected,setSelected]=useState("");
 const [depart,setDepart]=useState("07:00");
 const [notice,setNotice]=useState("");
 const [routeBusy,setRouteBusy]=useState(false);
 const [returnMinutes,setReturnMinutes]=useState<number|null>(null);
 const [driveKm,setDriveKm]=useState<number|null>(null);
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>{
  try{const saved=JSON.parse(localStorage.getItem("epico-preview-itinerario-v1")||"null");
   if(saved&&Array.isArray(saved.stops))setStops(saved.stops.filter((x:RouteStop)=>
    x&&typeof x.id==="string"&&typeof x.vendorId==="string").slice(0,30));
   if(typeof saved?.depart==="string")setDepart(saved.depart);
   if(typeof saved?.returnMinutes==="number")setReturnMinutes(saved.returnMinutes);
   if(typeof saved?.driveKm==="number")setDriveKm(saved.driveKm);
  }catch{}
  setHydrated(true);
 },[]);
 useEffect(()=>{if(!hydrated)return;
   try{localStorage.setItem("epico-preview-itinerario-v1",JSON.stringify({stops,depart,returnMinutes,driveKm}));}catch{}
 },[stops,depart,returnMinutes,driveKm,hydrated]);
 const result=useMemo(()=>evaluateRoute(stops,vendors,tripDate,depart),[stops,vendors,tripDate,depart]);
 const calculateOnline=async()=>{
   const chosen=stops.map(stop=>vendors.find(v=>v.id===stop.vendorId));
   if(!chosen.length||chosen.some(x=>!x?.name.trim())){setNotice("Agrega sucursales válidas.");return;}
   setRouteBusy(true);
   try{
    const response=await fetch("/api/admin/purchases/route",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({stops:chosen.map(v=>v!.address||v!.name+" Puebla México"),optimize:true})
    });
    const data=await response.json() as {order?:number[];legMinutes?:number[];
      returnMinutes?:number;distanceKm?:number;error?:string};
    if(!response.ok||!data.order||!data.legMinutes)throw Error(data.error||"Rutas no disponibles.");
    setStops(data.order.map((index,i)=>({
      ...stops[index],legMinutes:String(data.legMinutes?.[i]??"")
    })));
    setReturnMinutes(data.returnMinutes??null);
    setDriveKm(data.distanceKm??null);
    setNotice("Distancias y orden calculados con Google Routes. Los horarios pueden tener excepciones.");
   }catch(error){setNotice(error instanceof Error?error.message:"Error de consulta a Maps.");}
   finally{setRouteBusy(false)}
 };
 const patch=(id:string,values:Partial<RouteStop>)=>
  setStops(s=>s.map(x=>x.id===id?{...x,...values}:x));
 const changeOrder=(i:number,dir:number)=>{
  setStops(s=>{const a=s.map(x=>({...x,legMinutes:""})),j=i+dir;
   if(j<0||j>=a.length)return s;
   [a[i],a[j]]=[a[j],a[i]];return a;});
  setReturnMinutes(null);setDriveKm(null);
  setNotice("Ruta cambiada: vuelve a introducir tiempos de traslado de cada tramo.");
 };
 const mapParts=useMemo(()=>{
  const origin="Café Épico, Tepexi de Rodríguez, Puebla, México";
  const named=stops.map(s=>vendors.find(v=>v.id===s.vendorId))
   .filter((v):v is VendorProfile=>Boolean(v))
   .map(v=>({text:v.address.trim()||v.name.trim()+" Puebla, México",id:v.placeId||""}))
   .filter(v=>v.text.trim());
  if(!named.length)return [] as {label:string;url:string}[];
  const parts:{label:string;url:string}[]=[];
  // Hasta 3 paradas en cada enlace: compatible con navegadores móviles.
  for(let i=0;i<named.length;i+=3){
   const chunk=named.slice(i,i+3);
   const first=i===0?origin:named[i-1].text;
   const last=i+3>=named.length;
   const params=new URLSearchParams({api:"1",origin:first,
     destination:last?origin:chunk[chunk.length-1].text,
     travelmode:"driving"});
   const waypoints=last?chunk:chunk.slice(0,-1);
   if(waypoints.length){
     params.set("waypoints",waypoints.map(w=>w.text).join("|"));
     if(waypoints.every(w=>w.id))params.set("waypoint_place_ids",waypoints.map(w=>w.id).join("|"));
   }
   parts.push({label:named.length<=3?"Abrir ruta completa en Google Maps ↗":
     "Maps · tramo "+(parts.length+1)+" ↗",
     url:"https://www.google.com/maps/dir/?"+params.toString()});
  }
  return parts;
 },[stops,vendors]);
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
   <button type="button" className="abp-button" disabled={!stops.length||routeBusy}
     onClick={()=>void calculateOnline()}>{routeBusy?"Consultando…":"Optimizar ruta y tiempos automáticamente"}</button>
   <button type="button" className="abp-button" disabled={!vendors.some(v=>v.name.trim())}
    onClick={()=>{setStops(old=>{
      const used=new Set(old.map(x=>x.vendorId));
      return [...old,...vendors.filter(v=>v.name.trim()&&!used.has(v.id)).slice(0,8).map(v=>({
       id:crypto.randomUUID(),vendorId:v.id,legMinutes:"",visitMinutes:"20"}))];
     });}}>Añadir proveedores a la ruta</button>
   <button type="button" className="abp-button" disabled={stops.length<2}
    onClick={()=>{setStops(s=>reorderByClosingTime(s,vendors));
     setNotice("Sugerencia de cierres más tempranos (NO optimiza kilómetros). Introduce tiempos por tramo.");}}>
    Sugerir orden por cierres</button>
   <button type="button" className="abp-button"
    onClick={()=>{void navigator.clipboard.writeText(textRoute()).then(()=>setNotice("Itinerario copiado.")).catch(()=>setNotice("No se pudo copiar."));}}>
    Copiar itinerario</button>
   {mapParts.map(part=><a key={part.url} className="abp-button primary"
      target="_blank" rel="noopener noreferrer" href={part.url}>{part.label}</a>)}
  </div>
  {notice&&<p className="abp-warning" role="status">{notice}</p>}
  <div className="abp-summary">
   <strong>Inicio: Café Épico / Tepexi · {tripDate||"sin fecha"} {depart}</strong>
   <span>{result.steps.length} paradas · {result.warnings} observación(es)
    · última salida calculable: {clock(result.endTime)}
    {returnMinutes!==null&&" · regreso "+returnMinutes+" min"}
    {driveKm!==null&&" · "+driveKm.toFixed(1)+" km de traslado"}</span>
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
  <p className="abp-foot">La optimización automática usa Google Routes cuando haya una clave
    habilitada. Mientras tanto el enlace a Maps funciona y allí se muestran los tiempos
    con el tráfico disponible. El cálculo manual no incluye el regreso hasta Tepexi. La sugerencia por
   horario no sustituye optimización geográfica; confirmar aperturas y tráfico antes de salir.</p>
 </section>;
}
