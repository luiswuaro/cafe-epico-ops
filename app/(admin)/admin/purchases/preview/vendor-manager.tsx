"use client";
import {useEffect,useState} from "react";
import type {VendorProfile} from "@/src/domain/purchases/route-schedule";
export type {VendorProfile} from "@/src/domain/purchases/route-schedule";
const storeKey="epico-abasto-vendors-v3";
const newVendor=():VendorProfile=>({id:crypto.randomUUID(),name:"",chain:"OTRO",address:"",postal:"",opening:"",closing:"",openDays:"",notes:"",website:"",provenance:"MANUAL"});
export function useLocalVendors(names:string[]){
 const [vendors,setVendors]=useState<VendorProfile[]>([]);
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  let saved:VendorProfile[]=[];
  try{const v=JSON.parse(localStorage.getItem(storeKey)||"[]");
   if(Array.isArray(v))saved=v.filter(x=>x&&typeof x.id==="string"&&typeof x.name==="string").slice(0,150);
  }catch{}
  const complete=[...saved];
  for(const name of names)if(!complete.some(v=>v.name.toLowerCase()===name.toLowerCase()))
   complete.push({...newVendor(),name,provenance:"OPS"});
  setVendors(complete);setReady(true);
 },[names]);
 useEffect(()=>{if(ready)try{localStorage.setItem(storeKey,JSON.stringify(vendors));}catch{}},[vendors,ready]);
 const patch=(id:string,values:Partial<VendorProfile>)=>
  setVendors(a=>a.map(v=>v.id===id?{...v,...values}:v));
 return {vendors,setVendors,patch,ready};
}
export function VendorManager({vendors,patch,add,remove}:{
 vendors:VendorProfile[];patch:(id:string,v:Partial<VendorProfile>)=>void;add:(v:VendorProfile)=>void;remove:(id:string)=>void;
}){
 const [query,setQuery]=useState("");
 const list=vendors.filter(v=>(v.name+" "+v.postal+" "+v.address).toLowerCase().includes(query.toLowerCase()));
 return <section className="abp-panel">
  <h2>Directorio de proveedores y sucursales</h2>
  <p className="abp-lead">Edita el nombre, dirección, CP y horario de cada sucursal.
   Los cambios solo se guardan en este navegador, no en la base OPS.</p>
  <div className="abp-actions">
   <button type="button" className="abp-button primary" onClick={()=>add(newVendor())}>+ Nuevo proveedor</button>
   <button type="button" className="abp-button" onClick={()=>add({
    ...newVendor(),name:"Sam's Club La Noria",chain:"SAMS",
    address:"Circuito Juan Pablo II 1920, La Noria, Puebla, Pue.",postal:"72410",provenance:"PLANTILLA",
    notes:"Dirección de referencia. Confirmar horario directamente con la tienda."
   })}>+ Plantilla Sam’s La Noria</button>
  </div>
  <label>Buscar nombre, dirección o código postal
   <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="La Noria, 72410, Walmart..."/></label>
  <div className="abp-list">{list.map(v=><details className="abp-row-details" key={v.id}>
   <summary>{v.name||"Nuevo proveedor"} · {v.chain} · CP {v.postal||"sin definir"}</summary>
   <div className="abp-stacked">
    <div className="abp-fields cols-3">
     <label>Proveedor / nombre de tienda<input value={v.name} onChange={e=>patch(v.id,{name:e.target.value})}/></label>
     <label>Tipo<select value={v.chain} onChange={e=>patch(v.id,{chain:e.target.value as VendorProfile["chain"]})}>
      <option value="OTRO">Otro</option><option value="SAMS">Sam’s Club</option>
      <option value="WALMART">Walmart</option></select></label>
     <label>Código postal<input inputMode="numeric" maxLength={5} value={v.postal}
      onChange={e=>patch(v.id,{postal:e.target.value.replace(/\D/g,"").slice(0,5)})}/></label>
     <label style={{gridColumn:"1/-1"}}>Dirección precisa<input value={v.address}
      onChange={e=>patch(v.id,{address:e.target.value})}/></label>
     <label>Abre a las<input type="time" value={v.opening}
      onChange={e=>patch(v.id,{opening:e.target.value})}/></label>
     <label>Cierra a las<input type="time" value={v.closing}
      onChange={e=>patch(v.id,{closing:e.target.value})}/></label>
     <label>Notas / restricciones<input value={v.notes}
      onChange={e=>patch(v.id,{notes:e.target.value})}/></label>
    </div>
    <div className="abp-days"><strong>Días de apertura (capturados por operador):</strong>
     {["D","L","M","M","J","V","S"].map((day,i)=><label key={i}>
       <input type="checkbox" checked={v.openDays.includes(String(i))}
        onChange={e=>patch(v.id,{openDays:e.target.checked?
         [...new Set((v.openDays+String(i)).split(""))].sort().join(""):
         v.openDays.replace(String(i),"")})}/>{day}</label>)}
    </div>
    <div className="abp-actions">
     {v.address&&<a className="abp-button" target="_blank" rel="noopener noreferrer"
      href={"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(v.address)}>
       Verificar ubicación ↗</a>}
     <button type="button" className="abp-button" onClick={()=>{if(window.confirm("¿Quitar de la preview sin modificar OPS?"))remove(v.id);}}>
       Quitar proveedor de preview</button>
    </div>
    <p className="abp-foot">Horario sin capturar = desconocido; el itinerario no lo considerará confirmado.
     Proveedor original: {v.provenance==="OPS"?"registro OPS (no editable en producción desde aquí)":"escenario local"}.</p>
   </div>
  </details>)}
  {list.length===0&&<p className="abp-muted">Sin coincidencias.</p>}
  </div>
 </section>;
}
