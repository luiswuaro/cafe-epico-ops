"use client";
import {useEffect,useState} from "react";
import type {VendorProfile} from "@/src/domain/purchases/route-schedule";
type Quote={id:string;vendorId:string;item:string;sku:string;normal:string;offer:string;
 count:string;units:string;source:string;date:string;validTo:string;conditions:string};
const key="epico-abasto-quotes-v2";
const blank=():Quote=>({id:crypto.randomUUID(),vendorId:"",item:"",sku:"",normal:"",
 offer:"",count:"",units:"",source:"",date:"",validTo:"",conditions:""});
const peso=(v:number|null)=>v===null?"Pendiente":v.toLocaleString("es-MX",{style:"currency",currency:"MXN"});
const numeric=(v:string)=>v.trim()&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const official=(store:VendorProfile)=>
 store.chain==="SAMS"?"https://www.sams.com.mx/content/cuponera/480001":
 store.chain==="WALMART"?"https://www.walmart.com.mx/content/especiales/promociones-walmart/360013_990007":"";
export function OfferDesk({vendors}:{vendors:VendorProfile[]}){
 const [query,setQuery]=useState("leche"),[byStore,setByStore]=useState("");
 const [quotes,setQuotes]=useState<Quote[]>([]),[ready,setReady]=useState(false);
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(key)||"[]");
  if(Array.isArray(v))setQuotes(v.filter(x=>x&&typeof x.id==="string").slice(0,100));}catch{}
  setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(key,JSON.stringify(quotes));}catch{}},[quotes,ready]);
 const change=(id:string,patch:Partial<Quote>)=>
  setQuotes(v=>v.map(x=>x.id===id?{...x,...patch}:x));
 const shops=vendors.filter(x=>x.chain==="SAMS"||x.chain==="WALMART");
 return <div className="abp-stacked">
  <section className="abp-panel">
   <h2>Buscar precios y ofertas por sucursal</h2>
   <p className="abp-lead">La búsqueda abre el catálogo web de Sam’s o Walmart.
    Selecciona la tienda o CP dentro del comercio para ver su precio aplicable.
    La preview no tiene conexión autenticada a sus inventarios ni promociones en vivo.</p>
   <div className="abp-fields cols-2">
    <label>Producto exacto o marca<input value={query} onChange={e=>setQuery(e.target.value)}
      placeholder="Leche Lala deslactosada caja 12 L"/></label>
    <label>Nombre de sucursal o CP<input value={byStore}
      onChange={e=>setByStore(e.target.value)} placeholder="Sam's La Noria / 72410"/></label>
   </div>
   <div className="abp-list">{shops.filter(x=>(x.name+" "+x.postal+" "+x.address).toLowerCase().includes(byStore.toLowerCase())).map(v=>
    <div className="abp-stop" key={v.id}><div>
     <strong>{v.name}</strong><p className="abp-foot">{v.postal||"CP por configurar"} · {v.address||"Dirección pendiente"}</p>
     </div><div className="abp-actions">
      <a className="abp-button" target="_blank" rel="noopener noreferrer"
       href={"https://www.google.com/search?q="+encodeURIComponent("site:"+(v.chain==="SAMS"?"sams.com.mx":"walmart.com.mx")+" "+query)}>
       Buscar producto ↗</a>
      <a className="abp-button" target="_blank" rel="noopener noreferrer" href={official(v)}>
       Ver ofertas oficiales ↗</a>
     </div></div>)}
    {shops.length===0&&<p className="abp-muted">Primero configura una sucursal Sam’s o Walmart en «Proveedores».</p>}
   </div>
   <p className="abp-foot">No es una verificación automática: el precio online y las ofertas
    pueden cambiar por club, CP, stock, condición de socio o modalidad Pickup/entrega.
    Antes de comprar, confirma en la tienda y registra la evidencia.</p>
  </section>
  <section className="abp-panel">
   <div className="abp-inline" style={{justifyContent:"space-between"}}>
    <div><h2>Registro de cotizaciones con evidencia</h2>
     <p className="abp-lead">Cada precio se asocia a un producto, presentación,
      tienda, fecha de revisión y condiciones.</p></div>
    <button type="button" className="abp-button primary"
      onClick={()=>setQuotes(x=>[blank(),...x])}>+ Cotización</button>
   </div>
   <div className="abp-list">{quotes.map(q=>{
     const normal=numeric(q.normal),offer=numeric(q.offer),count=numeric(q.count),units=numeric(q.units);
     const saving=normal!==null&&offer!==null&&count!==null?normal*count-offer:null;
     const each=offer!==null&&count!==null&&count>0&&units!==null&&units>0?offer/(count*units):null;
     const expired=Boolean(q.validTo)&&q.validTo<new Date().toLocaleDateString("en-CA");
     const withEvidence=q.source.startsWith("https://")&&Boolean(q.date)&&Boolean(q.vendorId);
     return <details key={q.id} className="abp-row-details" defaultOpen={!q.item}>
      <summary>{q.item||"Cotización nueva"} · {vendors.find(x=>x.id===q.vendorId)?.name||"sin sucursal"}
       {" · "}{expired?"CADUCADA":withEvidence?"Con enlace (verificación manual)":"Sin fuente completa"}</summary>
      <div className="abp-stacked">
       <div className="abp-quote-fields">
        <label>Sucursal<select value={q.vendorId} onChange={e=>change(q.id,{vendorId:e.target.value})}>
         <option value="">Seleccionar…</option>
         {shops.map(s=><option key={s.id} value={s.id}>{s.name} · {s.postal||"sin CP"}</option>)}
        </select></label>
        <label>Producto y presentación<input value={q.item}
         onChange={e=>change(q.id,{item:e.target.value})}/></label>
        <label>SKU o código de barras<input value={q.sku}
         onChange={e=>change(q.id,{sku:e.target.value})}/></label>
        <label>Unidades por empaque<input type="number" min="0" step=".001" value={q.units}
         onChange={e=>change(q.id,{units:e.target.value})}/></label>
        <label>Precio normal de empaque (MXN)<input type="number" min="0" step=".01" value={q.normal}
         onChange={e=>change(q.id,{normal:e.target.value})}/></label>
        <label>Precio total de promoción (MXN)<input type="number" min="0" step=".01" value={q.offer}
         onChange={e=>change(q.id,{offer:e.target.value})}/></label>
        <label>Empaques incluidos en promoción<input type="number" min="0" step="1" value={q.count}
         onChange={e=>change(q.id,{count:e.target.value})}/></label>
        <label>Consulta realizada<input type="date" value={q.date} onChange={e=>change(q.id,{date:e.target.value})}/></label>
        <label>Vigencia hasta<input type="date" value={q.validTo} onChange={e=>change(q.id,{validTo:e.target.value})}/></label>
        <label style={{gridColumn:"1/-1"}}>URL del producto o promoción<input type="url" value={q.source}
         onChange={e=>change(q.id,{source:e.target.value})} placeholder="https://..."/></label>
        <label style={{gridColumn:"1/-1"}}>Condiciones y existencia confirmada<input value={q.conditions}
         onChange={e=>change(q.id,{conditions:e.target.value})}
         placeholder="Pickup, mínimo, socio, sucursal, comprobación telefónica..."/></label>
       </div>
       <div className="abp-summary">
        <span>Ahorro frente a precio normal × cantidad: <strong>{peso(saving)}</strong></span>
        <span>Precio promocional por unidad del empaque: <strong>{peso(each)}</strong></span>
        {expired&&<strong>Vigencia vencida: no usar para planear.</strong>}
        {!withEvidence&&<strong>No confirmada para esa sucursal.</strong>}
       </div>
       <div className="abp-actions">
        {q.source.startsWith("https://")&&<a href={q.source} className="abp-button"
         target="_blank" rel="noopener noreferrer">Abrir evidencia ↗</a>}
        <button type="button" className="abp-button"
         onClick={()=>setQuotes(list=>list.filter(x=>x.id!==q.id))}>Quitar cotización</button>
       </div>
      </div>
     </details>;
    })}
    {!quotes.length&&<p className="abp-muted">Agrega una cotización al obtener el precio exacto por tienda.</p>}
   </div>
  </section>
 </div>;
}
