"use client";
import {useState} from "react";
import type {PlaceMatch} from "@/src/domain/purchases/place-references";
import {referencePlaceSearch} from "@/src/domain/purchases/place-references";
export function PlaceFinder({onChoose}:{onChoose:(place:PlaceMatch)=>void}){
 const [q,setQ]=useState("Sam's La Noria");
 const [results,setResults]=useState<PlaceMatch[]>(referencePlaceSearch("Sam"));
 const [mode,setMode]=useState("DIRECTORIO"),[message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 async function lookup(){
  if(q.trim().length<3){setMessage("Escribe tienda, colonia, ciudad o código postal.");return;}
  setBusy(true);
  try{
   const response=await fetch("/api/admin/purchases/places?q="+encodeURIComponent(q.trim()),{cache:"no-store"});
   if(!response.ok)throw Error("HTTP "+response.status);
   const data=await response.json() as {places?:PlaceMatch[];mode?:string;message?:string};
   setResults(data.places??[]);setMode(data.mode||"DIRECTORIO");setMessage(data.message||"");
  }catch{
   setResults(referencePlaceSearch(q));setMode("DIRECTORIO");
   setMessage("Consulta no disponible; resultados del directorio de referencia.");
  }finally{setBusy(false)}
 }
 return <section className="abp-place-lookup">
  <h3>Buscar establecimiento automáticamente</h3>
  <p className="abp-lead">Busca por nombre, sucursal o CP. OPS puede completar dirección,
   horario, código postal e identificador de Maps; las referencias del directorio NO son consulta en vivo.</p>
  <div className="abp-inline">
   <label>Establecimiento o código postal
    <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Sam's La Noria, Walmart Las Ánimas, 72410"
     onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void lookup();}}}/></label>
   <button type="button" className="abp-button primary" disabled={busy}
    onClick={()=>void lookup()}>{busy?"Buscando…":"Buscar sucursales"}</button>
  </div>
  <p className="abp-foot">{mode==="GOOGLE_PLACES"?"Consulta desde Google Places":
   "Directorio precargado"} · {message||"Referencias disponibles; comprueba horarios especiales."}</p>
  <div className="abp-list">{results.map(item=><div className="abp-stop" key={item.placeId}>
   <div><strong>{item.name}</strong><div className="abp-muted">{item.address}</div>
    <div className="abp-muted">Horario habitual: {item.opening&&item.closing?
      item.opening+"–"+item.closing:"no confirmado"} · {item.hoursNote}</div>
   </div>
   <div className="abp-actions">
    <a className="abp-button" target="_blank" rel="noopener noreferrer" href={item.mapsUrl}>
     Maps ↗</a>
    <button className="abp-button primary" type="button" onClick={()=>onChoose(item)}>
     Incorporar sucursal</button>
   </div>
  </div>)}
  {results.length===0&&<p className="abp-muted">Sin coincidencias. Conectar Google Places API amplía la búsqueda a otros comercios.</p>}
  </div>
 </section>;
}
