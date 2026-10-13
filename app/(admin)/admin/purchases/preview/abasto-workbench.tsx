"use client";
import {useEffect,useMemo,useState} from "react";
import type {BuyMode,InventorySeed,SupplyKind,SupplyLine,SupplyDecision} from "@/src/domain/purchases/abastecimiento-plan";
import {calculateSupplyPlan,nonnegative} from "@/src/domain/purchases/abastecimiento-plan";
import {useLocalVendors,VendorManager} from "./vendor-manager";
import {RouteItinerary} from "./route-itinerary";
import {OfferDesk} from "./offer-desk";

type Props={seeds:InventorySeed[];suppliers:string[];observedDays:number};
type Tab="PLAN"|"RUTA"|"RECIBIR"|"PROVEEDORES"|"OFERTAS"|"REGLAS";
type DraftPurchase={id:string;name:string;amount:string;presentation:string;price:string;supplier:string};
const cashFmt=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:2});
const numFmt=new Intl.NumberFormat("es-MX",{maximumFractionDigits:3});
const storageKey="epico-abasto-preview-liquidez-v1";
const showPrice=(n:number|null|undefined)=>n===null||n===undefined?"Sin precio":cashFmt.format(n);
const kindFromName=(name:string):SupplyKind=>{
 const n=name.toLowerCase();
 if(/café verde|cafe verde|green coffee|grano verde/.test(n))return "CAFE_VERDE";
 if(/leche|queso|lechuga|pan\b|jam[oó]n|huevo|crema|fruta|lim[oó]n|hojaldra|croissant|verdura/.test(n))
   return "PERECEDERO";
 return "ESTABLE";
};
const factor=(unit:SupplyLine["unit"])=>unit==="pz"?1:1000;
const shopUnit=(unit:SupplyLine["unit"])=>unit==="g"?"kg":unit==="ml"?"L":"pz";
const fmtUnits=(n:number|null,unit:SupplyLine["unit"])=>n===null?"Sin conteo":numFmt.format(n/factor(unit))+" "+shopUnit(unit);
const basicLine=(seed:InventorySeed):SupplyLine=>({
  ...seed,chosen:seed.severity==="AGOTADO"||seed.severity==="BAJO_MINIMO"||
    (kindFromName(seed.name)==="PERECEDERO"&&/pan|lechuga|leche/i.test(seed.name)),
  kind:kindFromName(seed.name),supplier:"",manualQty:"",unitPrice:"",boxUnits:"",
  boxPrice:"",shelfDays:"",inTransit:"",buyMode:"AUTO"
});
function daysTo(date:string){
 if(!date)return 0;
 const noon=new Date(date+"T12:00:00");
 if(Number.isNaN(noon.getTime()))return 0;
 const now=new Date();
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
 return Math.max(0,Math.ceil((noon.getTime()-start.getTime())/86400000));
}
const labelStatus:Record<SupplyDecision["status"],string>={
 NO_DATOS:"Falta pronóstico",NO_PRECIO:"Falta precio",NO_NECESARIO:"Sin reposición",
 CON_PRESUPUESTO:"Financiable",PARCIAL:"Parcial",SIN_PRESUPUESTO:"Falta efectivo",
 PENDIENTE_PRESUPUESTO:"Validar presupuesto"
};
const labelKind:Record<SupplyKind,string>={
 PERECEDERO:"Perecedero semanal",ESTABLE:"Estable / caja",CAFE_VERDE:"Café verde / tueste"
};
const numeric=(value:string)=>nonnegative(value)??0;
function normalizeLine(line:SupplyLine):SupplyLine {
 const f=factor(line.unit);
 return {...line,
   manualQty:line.manualQty===""?"":String(numeric(line.manualQty)*f),
   inTransit:line.inTransit===""?"":String(numeric(line.inTransit)*f),
   unitPrice:line.unitPrice===""?"":String(numeric(line.unitPrice)/f),
   boxUnits:line.boxUnits===""?"":String(numeric(line.boxUnits)*f)
 };
}
const examplePurchases:DraftPurchase[]=[
 {id:"leche",name:"Leche",amount:"5",presentation:"cajas",price:"",supplier:""},
 {id:"verde",name:"Café verde",amount:"10",presentation:"kg",price:"",supplier:""},
 {id:"tonica",name:"Agua tónica",amount:"",presentation:"piezas",price:"",supplier:""},
 {id:"mineral",name:"Agua mineral",amount:"",presentation:"piezas",price:"",supplier:""}
];
const moneyOrUnknown=(n:number|null)=>n===null?"Pendiente":cashFmt.format(n);

export function AbastoWorkbench({seeds,suppliers,observedDays}:Props){
 const [tab,setTab]=useState<Tab>("PLAN");
 const {vendors,setVendors,patch:patchVendor}=useLocalVendors(suppliers);
 const [costPurchaseId,setCostPurchaseId]=useState("leche");
 const [costItemId,setCostItemId]=useState("");
 const [costUnits,setCostUnits]=useState("");
 const [rows,setRows]=useState<SupplyLine[]>(()=>seeds.map(basicLine));
 const [cash,setCash]=useState(""),[reserve,setReserve]=useState("");
 const [tripDate,setTripDate]=useState(""),[cycleDays,setCycleDays]=useState("7");
 const [routeKm,setRouteKm]=useState(""),[fuelPrice,setFuelPrice]=useState("28");
 const [efficiency,setEfficiency]=useState("14"),[tolls,setTolls]=useState("");
 const [parking,setParking]=useState(""),[extra,setExtra]=useState("");
 const [timeHours,setTimeHours]=useState(""),[hourRate,setHourRate]=useState("");
 const [tripPurpose,setTripPurpose]=useState("Compartido / semanal");
 const [places,setPlaces]=useState<string[]>([]);
 const [placeInput,setPlaceInput]=useState("");
 const [purchases,setPurchases]=useState<DraftPurchase[]>(examplePurchases);
 const [received,setReceived]=useState<Record<string,boolean>>({});
 const [search,setSearch]=useState(""),[filter,setFilter]=useState("PRIORIDAD");
 const [notice,setNotice]=useState("");
 const [hydrated,setHydrated]=useState(false);
 useEffect(()=>{
   try{
     const saved=JSON.parse(window.localStorage.getItem(storageKey)||"null") as Record<string,unknown>|null;
     if(saved&&Array.isArray(saved.lines)){
       const savedLines=new Map<string,Partial<SupplyLine>>();
       for(const row of saved.lines){
         if(row&&typeof row==="object"&&typeof row.id==="string")savedLines.set(row.id,row);
       }
       setRows(seeds.map(seed=>{
         const previous=savedLines.get(seed.id);
         const base=basicLine(seed);
         if(!previous)return base;
         return {...base,chosen:typeof previous.chosen==="boolean"?previous.chosen:base.chosen,
           kind:previous.kind==="PERECEDERO"||previous.kind==="ESTABLE"||previous.kind==="CAFE_VERDE"
             ?previous.kind:base.kind,
           supplier:typeof previous.supplier==="string"?previous.supplier:"",
           manualQty:typeof previous.manualQty==="string"?previous.manualQty:"",
           unitPrice:typeof previous.unitPrice==="string"?previous.unitPrice:"",
           boxUnits:typeof previous.boxUnits==="string"?previous.boxUnits:"",
           boxPrice:typeof previous.boxPrice==="string"?previous.boxPrice:"",
           shelfDays:typeof previous.shelfDays==="string"?previous.shelfDays:"",
           inTransit:typeof previous.inTransit==="string"?previous.inTransit:"",
           buyMode:previous.buyMode==="SUELTO"||previous.buyMode==="CAJA"
             ?previous.buyMode:"AUTO"};
       }));
     }
     const read=(key:string,setter:(value:string)=>void)=>{
       if(saved&&typeof saved[key]==="string")setter(saved[key] as string);
     };
     read("cash",setCash);read("reserve",setReserve);read("tripDate",setTripDate);
     read("cycleDays",setCycleDays);read("routeKm",setRouteKm);
     read("fuelPrice",setFuelPrice);read("efficiency",setEfficiency);
     read("tolls",setTolls);read("parking",setParking);read("extra",setExtra);
     read("timeHours",setTimeHours);read("hourRate",setHourRate);
     read("tripPurpose",setTripPurpose);
     if(saved&&Array.isArray(saved.places))setPlaces(saved.places.filter(x=>typeof x==="string").slice(0,20));
     if(saved&&Array.isArray(saved.purchases))setPurchases(saved.purchases as DraftPurchase[]);
   }catch{ /* Los datos locales son opcionales. */}
   setHydrated(true);
 },[seeds]);
 useEffect(()=>{
   if(!hydrated)return;
   try{window.localStorage.setItem(storageKey,JSON.stringify({
     lines:rows.map(x=>({id:x.id,chosen:x.chosen,kind:x.kind,supplier:x.supplier,
       manualQty:x.manualQty,unitPrice:x.unitPrice,boxUnits:x.boxUnits,boxPrice:x.boxPrice,
       shelfDays:x.shelfDays,inTransit:x.inTransit,buyMode:x.buyMode})),
     cash,reserve,tripDate,cycleDays,routeKm,fuelPrice,efficiency,tolls,parking,extra,
     timeHours,hourRate,tripPurpose,places,purchases
   }));}catch{/* Disponible solo en esta sesión. */}
 },[hydrated,rows,cash,reserve,tripDate,cycleDays,routeKm,fuelPrice,efficiency,tolls,
   parking,extra,timeHours,hourRate,tripPurpose,places,purchases]);
 const update=(id:string,patch:Partial<SupplyLine>)=>
   setRows(all=>all.map(x=>x.id===id?{...x,...patch}:x));
 const updatePurchase=(id:string,patch:Partial<DraftPurchase>)=>
   setPurchases(list=>list.map(x=>x.id===id?{...x,...patch}:x));
 const travel=useMemo(()=>{
   const km=nonnegative(routeKm),price=nonnegative(fuelPrice),perL=nonnegative(efficiency);
   const fuel=km!==null&&price!==null&&perL!==null&&perL>0?km/perL*price:null;
   const extras=numeric(tolls)+numeric(parking)+numeric(extra);
   const cashCost=fuel===null?null:fuel+extras;
   const hours=nonnegative(timeHours),rate=nonnegative(hourRate);
   const opportunity=hours!==null&&rate!==null?hours*rate:null;
   return {fuel,cashCost,opportunity};
 },[routeKm,fuelPrice,efficiency,tolls,parking,extra,timeHours,hourRate]);
 const untilTrip=daysTo(tripDate);
 const weekDays=Math.max(1,Math.min(30,Number(cycleDays)||7));
 const decisions=useMemo(()=>calculateSupplyPlan(
   rows.map(normalizeLine),cash,reserve,travel.cashCost,untilTrip,weekDays
 ),[rows,cash,reserve,travel.cashCost,untilTrip,weekDays]);
 const essentialUnpriced=decisions.decisions.some(d=>d.urgency<=2&&
   (d.status==="NO_DATOS"||d.status==="NO_PRECIO"));
 const chosen=rows.filter(x=>x.chosen).length;
 const funded=decisions.decisions.filter(d=>d.status==="CON_PRESUPUESTO"||d.status==="PARCIAL");
 const plannedMoney=decisions.decisions.reduce((sum,d)=>sum+(
   d.status==="NO_PRECIO"||d.status==="NO_DATOS"||d.status==="NO_NECESARIO"
     ?0:d.estimatedCost??0),0);
 const hasEstimate=decisions.decisions.some(d=>d.required!==null&&d.required>0);
 const filtered=rows.filter(x=>{
   const q=search.toLowerCase().trim();
   if(q&&!((x.name+" "+x.supplier).toLowerCase().includes(q)))return false;
   if(filter==="PERECEDEROS")return x.kind==="PERECEDERO";
   if(filter==="CAJAS")return x.kind!=="PERECEDERO";
   if(filter==="SELECCIONADOS")return x.chosen;
   if(filter==="PRIORIDAD")return x.chosen||x.severity==="AGOTADO"||x.severity==="BAJO_MINIMO";
   return true;
 });
 const purchasesKnown=purchases.reduce((s,r)=>r.price.trim()!==""?s+numeric(r.price):s,0);
 const purchaseMissing=purchases.filter(r=>r.price.trim()==="").length;
 const purchaseMissingQty=purchases.filter(r=>r.amount.trim()==="").length;
 const transportTotal=travel.cashCost===null?null:travel.cashCost+purchasesKnown;
 const clipboardText=()=>[
   "CAFÉ ÉPICO · PLAN DE ABASTECIMIENTO · PREVIEW",
   "Fecha de salida: "+(tripDate||"sin definir"),
   "Disponible: "+(cash||"sin registrar")+" MXN · Reserva: "+(reserve||"sin registrar")+" MXN",
   "Traslado: "+moneyOrUnknown(travel.cashCost),
   ...decisions.decisions.map(d=>
     d.line.name+" | "+labelStatus[d.status]+" | "+
     fmtUnits(d.required,d.line.unit)+" requeridos | "+
     fmtUnits(d.units,d.line.unit)+" planeados | "+
     (d.mode==="CAJA"?String(d.boxes)+" cajas":"fraccionado")+" | "+
     moneyOrUnknown(d.estimatedCost))
 ].join("\n");
 async function copy(){
   try{await navigator.clipboard.writeText(clipboardText());setNotice("Plan copiado. Los importes sin precio siguen pendientes.");}
   catch{setNotice("No se pudo copiar automáticamente. Revisa los permisos del navegador.");}
 }
 function resetScenario(){
   setRows(seeds.map(basicLine));setCash("");setReserve("");setTripDate("");setCycleDays("7");
   setRouteKm("");setFuelPrice("28");setEfficiency("14");setTolls("");setParking("");
   setExtra("");setTimeHours("");setHourRate("");setPlaces([]);setTripPurpose("Compartido / semanal");
   setPurchases(examplePurchases);setReceived({});setNotice("Escenario reiniciado sin modificar inventario OPS.");
 }
 const tabs:[Tab,string][]=[
   ["PLAN","1 · Compras y liquidez"],["RUTA","2 · Ruta y costos"],
   ["RECIBIR","3 · Recepción"],["PROVEEDORES","4 · Proveedores"],
   ["OFERTAS","5 · Precios y promociones"],["REGLAS","6 · Auditoría"]
 ];
 return <>
  <div className="abp-tabs" role="tablist" aria-label="Secciones de abastecimiento">
   {tabs.map(([id,name])=><button key={id} type="button" role="tab"
     className="abp-tab" aria-selected={tab===id} onClick={()=>{setTab(id);setNotice("");}}>
     {name}</button>)}
  </div>
  <section className="abp-grid" aria-label="Indicadores de escenario">
   <div className="abp-kpi"><small>Efectivo después de reserva y traslado</small>
     <b>{moneyOrUnknown(decisions.availableAfterReserve)}</b>
     <small>No es saldo bancario; escribe presupuesto de viaje</small></div>
   <div className="abp-kpi"><small>Compra financiable (estimada)</small>
     <b>{decisions.unknownBudget?"Pendiente":showPrice(decisions.estimatedSpend)}</b>
     <small>{funded.length} renglones con cobertura del presupuesto</small></div>
   <div className="abp-kpi"><small>Faltantes de información</small>
     <b>{decisions.missingPrices+decisions.missingForecasts}</b>
     <small>{decisions.missingPrices} sin precio; {decisions.missingForecasts} sin pronóstico</small></div>
   <div className="abp-kpi"><small>Recursos no financiados</small>
     <b>{decisions.unknownBudget?"Por evaluar":decisions.unfunded}</b>
     <small>Cajas adicionales solo tras cubrir compras prioritarias</small></div>
  </section>
  {notice&&<p role="status" className="abp-warning">{notice}</p>}
  {tab==="PLAN"&&<section className="abp-stacked">
   <div className="abp-panel">
    <h2>Política de caja: primero operar, después comprar por caja</h2>
    <p className="abp-lead">Se calculan necesidades con inventario OPS y consumo LIVE observado.
      La ruta semanal de pan, lechuga y otros perecederos funciona como día ancla.
      La reserva de efectivo queda intocable en el escenario.</p>
    <div className="abp-fields">
     <label>Presupuesto disponible para abastecimiento (MXN)
      <input type="number" min="0" step=".01" value={cash} onChange={e=>setCash(e.target.value)}
       placeholder="Capturar efectivo realmente disponible"/></label>
     <label>Reserva mínima no gastable (MXN)
      <input type="number" min="0" step=".01" value={reserve} onChange={e=>setReserve(e.target.value)}
        placeholder="Reserva para operación"/></label>
     <label>Próxima salida semanal
      <input type="date" value={tripDate} onChange={e=>setTripDate(e.target.value)}/></label>
     <label>Días entre viajes
      <input type="number" min="1" max="30" step="1" value={cycleDays}
        onChange={e=>setCycleDays(e.target.value)}/></label>
    </div>
    <div className="abp-summary">
      <strong>{tripDate?"Próxima salida en "+untilTrip+" día(s)":"Fecha de salida aún no configurada"}</strong>
      <span>Ruta de transporte: {moneyOrUnknown(travel.cashCost)} ·
        efectivo reservado: {reserve===""?"pendiente":cashFmt.format(numeric(reserve))}.</span>
      <span>Compras sugeridas con presupuesto: {decisions.unknownBudget?"pendiente":cashFmt.format(decisions.estimatedSpend)}
        {" "}· efectivo libre restante: {moneyOrUnknown(decisions.remainingCash)}.</span>
      {travel.cashCost===null&&<strong>Falta capturar kilómetros o un traslado verificable en «Ruta y costos» para simular financiamiento.</strong>}
      {cash.trim()===""&&<strong>Falta definir presupuesto; no se asignarán compras sin conocer el efectivo disponible.</strong>}
      {essentialUnpriced&&<strong>Hay necesidades esenciales sin costo o consumo verificable; compras no urgentes y cajas adicionales quedan pospuestas.</strong>}
    </div>
    <div className="abp-actions">
      <button type="button" className="abp-button primary" onClick={()=>setTab("RUTA")}>
       Configurar traslado →</button>
      <button type="button" className="abp-button" onClick={()=>void copy()}>Copiar plan</button>
      <button type="button" className="abp-button" onClick={resetScenario}>Reiniciar simulación</button>
    </div>
   </div>
   <div className="abp-panel">
    <div className="abp-inline" style={{justifyContent:"space-between"}}>
      <div><h2>Insumos y precios de compra</h2>
       <p className="abp-lead">{seeds.length} insumos reales OPS · {chosen} seleccionados.
       {observedDays>=3?" Consumo observado en "+observedDays+" días con ventas LIVE.":
       " Historial insuficiente para extrapolar demanda. Configura cantidades manuales."}</p>
       <p className="abp-lead">La clasificación inicial de perecederos se sugiere por nombre;
        confirma tipo, caducidad, tamaño de caja y proveedor antes de confiar en el plan.</p></div>
      <div className="abp-actions"><button type="button" className="abp-button"
        onClick={()=>setRows(all=>all.map(x=>({...x,chosen:true})))}>
        Seleccionar todos</button>
       <button type="button" className="abp-button"
        onClick={()=>setRows(all=>all.map(x=>({...x,chosen:false})))}>
        Ninguno</button></div>
    </div>
    <div className="abp-fields cols-2">
      <label>Buscar insumo o proveedor
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Leche, pan, tónica..."/></label>
      <label>Filtrar
       <select value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="PRIORIDAD">Prioritarios</option><option value="PERECEDEROS">Perecederos</option>
        <option value="CAJAS">No perecederos / café</option><option value="SELECCIONADOS">Seleccionados</option>
        <option value="TODOS">Inventario completo</option>
       </select></label>
    </div>
    <div className="abp-list">
      {filtered.map(row=>{
        const d=decisions.decisions.find(item=>item.line.id===row.id);
        const f=factor(row.unit);
        return <article key={row.id} className="abp-row-details">
          <div style={{padding:".65rem .7rem",display:"flex",gap:".65rem",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
            <label style={{display:"flex",alignItems:"center",flex:"1 1 220px",gap:".6rem"}}>
             <input type="checkbox" checked={row.chosen}
               onChange={e=>update(row.id,{chosen:e.target.checked})}/>
             <strong>{row.name}</strong></label>
            <span className="abp-chip">OPS: {fmtUnits(row.stock,row.unit)}</span>
            <span className="abp-chip">{row.daily===null?"Sin consumo estimable":
              numFmt.format(row.daily/f)+" "+shopUnit(row.unit)+"/día"}</span>
            {d&&<span className={"abp-chip "+(d.status==="PARCIAL"||d.status==="SIN_PRESUPUESTO"?"warn":"")}>
              {labelStatus[d.status]}</span>}
          </div>
          <div className="abp-quick-price">
            <label>Precio suelto (MXN/{shopUnit(row.unit)})
              <input type="number" min="0" step=".0001" value={row.unitPrice}
               aria-label={"Precio suelto "+row.name} onChange={e=>update(row.id,{unitPrice:e.target.value})}
               placeholder="Sin precio"/></label>
            <label>Precio de caja (MXN)
              <input type="number" min="0" step=".01" value={row.boxPrice}
               aria-label={"Precio de caja "+row.name} onChange={e=>update(row.id,{boxPrice:e.target.value})}
               placeholder="Sin precio"/></label>
            <span className="abp-muted">Puedes cambiar ambos importes. Define contenido de la caja en «Más parámetros».</span>
          </div>
          <details>
            <summary style={{cursor:"pointer",padding:".5rem .7rem",fontWeight:800,fontSize:".78rem"}}>
             Más parámetros: cantidad, proveedor, contenido y caducidad
            </summary>
            <div style={{padding:".7rem",borderTop:"1px solid var(--abp-line)"}}>
              <div className="abp-fields">
                <label>Tratamiento
                  <select value={row.kind} onChange={e=>update(row.id,{kind:e.target.value as SupplyKind})}>
                    <option value="PERECEDERO">Perecedero semanal</option>
                    <option value="ESTABLE">No perecedero</option>
                    <option value="CAFE_VERDE">Café verde</option></select></label>
                <label>Proveedor
                  <input list="abp-suppliers" value={row.supplier}
                    onChange={e=>update(row.id,{supplier:e.target.value})}
                    placeholder="Proveedor / zona"/></label>
                <label>Cantidad objetivo manual ({shopUnit(row.unit)})
                  <input type="number" min="0" step="0.001" value={row.manualQty}
                    onChange={e=>update(row.id,{manualQty:e.target.value})}
                    placeholder="Vacío = calcular con OPS"/></label>

                <label>Contenido de una caja ({shopUnit(row.unit)})
                  <input type="number" min="0" step=".001" value={row.boxUnits}
                    onChange={e=>update(row.id,{boxUnits:e.target.value})}
                    placeholder="Ej. 12 L"/></label>

                <label>Vida útil restante al recibir (días)
                  <input type="number" min="0" step="1" value={row.shelfDays}
                    onChange={e=>update(row.id,{shelfDays:e.target.value})}
                    placeholder="No verificada"/></label>
                <label>En tránsito confirmado ({shopUnit(row.unit)})
                  <input type="number" min="0" step=".001" value={row.inTransit}
                    onChange={e=>update(row.id,{inTransit:e.target.value})}/></label>
                <label>Estrategia
                  <select value={row.buyMode} onChange={e=>update(row.id,{buyMode:e.target.value as BuyMode})}>
                   <option value="AUTO">Automática con protección de efectivo</option>
                   <option value="SUELTO">Solo suelto</option><option value="CAJA">Forzar caja si es financiable</option>
                  </select></label>
              </div>
              <p className="abp-foot">Para g/ml se capturan precios y cantidades en kg/L; el motor convierte
                a gramos y mililitros. La cantidad manual reemplaza el cálculo automático de esa línea.</p>
            </div>
          </details>
        </article>;
      })}
      {filtered.length===0&&<p className="abp-muted">No hay insumos para este filtro. Revisa inventario completo o busca otro nombre.</p>}
    </div>
    <datalist id="abp-suppliers">{suppliers.map(s=><option key={s} value={s}/>)}</datalist>
   </div>
   <div className="abp-panel">
    <h2>Propuesta de compra ordenada por prioridad</h2>
    <p className="abp-lead">Se prioriza la continuidad operativa, se descuentan existencias y
     tránsito confirmado, y se proponen cajas solo si la cobertura y el efectivo lo permiten.</p>
    <div className="abp-table-wrap"><table className="abp-table">
      <thead><tr><th>Insumo</th><th>Necesidad</th><th>Presentación</th><th>Asignado</th><th>Importe</th><th>Estado</th></tr></thead>
      <tbody>{decisions.decisions.map(d=><tr key={d.line.id}>
       <td><strong>{d.line.name}</strong><div className="abp-muted">{labelKind[d.line.kind]}</div></td>
       <td>{fmtUnits(d.required,d.line.unit)}</td>
       <td>{d.boxes>0?d.boxes+" caja(s)":"Suelto"}</td>
       <td>{d.status==="NO_DATOS"||d.status==="NO_PRECIO"?"—":fmtUnits(d.units,d.line.unit)}</td>
       <td>{d.status==="NO_DATOS"||d.status==="NO_PRECIO"?"Pendiente":
           showPrice(d.estimatedCost)}</td>
       <td><span className={"abp-chip "+(["SIN_PRESUPUESTO","PARCIAL","NO_DATOS","NO_PRECIO"].includes(d.status)?"warn":"")}>
        {labelStatus[d.status]}</span><div className="abp-muted">{d.note}</div></td>
      </tr>)}
      {decisions.decisions.length===0&&<tr><td colSpan={6}>Selecciona insumos para preparar un plan.</td></tr>}
      </tbody></table></div>
    <p className="abp-foot">Sin precio = desconocido, no $0. Un plan provisional no equivale a una compra
      pagada ni a una recepción de mercancía.</p>
   </div>
  </section>}
  {tab==="RUTA"&&<RouteItinerary vendors={vendors} tripDate={tripDate}/>}
  {tab==="RUTA"&&<section className="abp-two">
    <div className="abp-stacked">
      <div className="abp-panel">
        <h2>Desembolso de traslado</h2>
        <div className="abp-fields cols-2">
         <label>Kilómetros totales (ida, paradas y regreso)
          <input type="number" min="0" step=".1" value={routeKm}
           onChange={e=>setRouteKm(e.target.value)} placeholder="Ruta real o estimada"/></label>
         <label>Rendimiento del vehículo (km/L)
          <input type="number" min=".1" step=".1" value={efficiency}
           onChange={e=>setEfficiency(e.target.value)}/></label>
         <label>Gasolina (MXN/L)
          <input type="number" min="0" step=".01" value={fuelPrice}
           onChange={e=>setFuelPrice(e.target.value)}/></label>
         <label>Casetas (MXN)
          <input type="number" min="0" step=".01" value={tolls}
           onChange={e=>setTolls(e.target.value)}/></label>
         <label>Estacionamientos (MXN)
          <input type="number" min="0" step=".01" value={parking}
           onChange={e=>setParking(e.target.value)}/></label>
         <label>Otros desembolsos (MXN)
          <input type="number" min="0" step=".01" value={extra}
           onChange={e=>setExtra(e.target.value)}/></label>
         <label>Horas dedicadas (opcional)
          <input type="number" min="0" step=".25" value={timeHours}
           onChange={e=>setTimeHours(e.target.value)}/></label>
         <label>Valor estimado de una hora (MXN)
          <input type="number" min="0" step=".01" value={hourRate}
           onChange={e=>setHourRate(e.target.value)}/></label>
        </div>
        <p className="abp-foot">Los valores 14 km/L y $28/L son referencias editables,
         NO consumos ni precios verificados para este viaje. El tiempo es costo de oportunidad separado.</p>
      </div>
    </div>
    <div className="abp-stacked">
      <div className="abp-panel">
       <h2>Evaluación económica de la salida</h2>
       <div className="abp-summary">
        <span>Combustible: <strong>{moneyOrUnknown(travel.fuel)}</strong></span>
        <span>Casetas, estacionamientos y otros: <strong>
          {cashFmt.format(numeric(tolls)+numeric(parking)+numeric(extra))}</strong></span>
        <span>Desembolso total del viaje: <strong>{moneyOrUnknown(travel.cashCost)}</strong></span>
        <span>Costo de oportunidad (no desembolsado): <strong>
          {moneyOrUnknown(travel.opportunity)}</strong></span>
        <span>Propósito: <strong>{tripPurpose}</strong></span>
       </div>
       <p className="abp-lead">Si el viaje será compartido, en la versión operativa asignaremos
        solo la proporción justificable a Café Épico y distinguiremos costos incrementales por parada.
        En esta preview mostramos el costo total sin inventar un prorrateo.</p>
       <button type="button" className="abp-button primary" onClick={()=>setTab("PLAN")}>
         Volver a evaluar presupuesto →</button>
      </div>
      <div className="abp-panel">
       <h2>Comparativa de capital</h2>
       <div className="abp-summary">
        <span>Presupuesto inicial: <strong>{cash===""?"Pendiente":cashFmt.format(numeric(cash))}</strong></span>
        <span>Reserva operativa: <strong>{reserve===""?"Pendiente":cashFmt.format(numeric(reserve))}</strong></span>
        <span>Viaje previsto: <strong>{moneyOrUnknown(travel.cashCost)}</strong></span>
        <span>Dinero para insumos: <strong>{moneyOrUnknown(decisions.availableAfterReserve)}</strong></span>
        <span>Compras elegibles: <strong>{decisions.unknownBudget?"Pendiente":cashFmt.format(decisions.estimatedSpend)}</strong></span>
       </div>
       <p className="abp-foot">No están incorporados los precios de artículos sin cotización,
         ni se consideran como cero. Ningún viaje se marca automáticamente como rentable.</p>
      </div>
    </div>
   </section>}
  {tab==="PROVEEDORES"&&<VendorManager vendors={vendors} patch={patchVendor}
     add={v=>setVendors(x=>[v,...x])} remove={id=>setVendors(x=>x.filter(v=>v.id!==id))}/>}
  {tab==="OFERTAS"&&<OfferDesk vendors={vendors}/>}
  {tab==="RECIBIR"&&<section className="abp-stacked">
    <div className="abp-panel">
      <h2>Registrar compra de hoy · borrador</h2>
      <p className="abp-lead">Cargado únicamente con las cantidades que mencionaste.
        No se supone el contenido de las cajas de leche ni las piezas de agua tónica/mineral.
        Agrega precios y proveedores cuando tengas tickets. Esta vista NO contabiliza compras.</p>
      <div className="abp-table-wrap"><table className="abp-table">
       <thead><tr><th>Material</th><th>Cantidad reportada</th><th>Presentación</th><th>Proveedor</th><th>Importe total MXN</th><th></th></tr></thead>
       <tbody>{purchases.map(p=><tr key={p.id}>
        <td><input value={p.name} aria-label="Nombre del insumo" style={{minWidth:120}}
          onChange={e=>updatePurchase(p.id,{name:e.target.value})}/></td>
        <td><input type="number" min="0" step=".001" value={p.amount}
          aria-label={"Cantidad "+p.name} style={{width:85}}
          onChange={e=>updatePurchase(p.id,{amount:e.target.value})}/></td>
        <td><input value={p.presentation} aria-label={"Presentación "+p.name} style={{width:85}}
          onChange={e=>updatePurchase(p.id,{presentation:e.target.value})}/></td>
        <td><input value={p.supplier} aria-label={"Proveedor "+p.name} style={{minWidth:105}}
          onChange={e=>updatePurchase(p.id,{supplier:e.target.value})}/></td>
        <td><input type="number" min="0" step=".01" value={p.price}
          aria-label={"Costo total "+p.name} style={{width:110}}
          onChange={e=>updatePurchase(p.id,{price:e.target.value})}/></td>
        <td><button type="button" className="abp-button"
          onClick={()=>setPurchases(ps=>ps.filter(q=>q.id!==p.id))}>×</button></td>
       </tr>)}</tbody>
      </table></div>
      <div className="abp-link-price">
       <h3>Vincular precios del ticket a insumos del simulador</h3>
       <p className="abp-lead">Elige la compra y el insumo exacto. Declara cuántos kg, L o pz contiene
        cada caja o presentación. Ejemplo: 5 cajas a $1,440, 12 L por caja: $288/caja y $24/L.
        No se presume el contenido.</p>
       <div className="abp-fields cols-3">
        <label>Compra del ticket<select value={costPurchaseId} onChange={e=>setCostPurchaseId(e.target.value)}>
         {purchases.map(p=><option key={p.id} value={p.id}>{p.name||"Sin nombre"} · {p.amount} {p.presentation}</option>)}
        </select></label>
        <label>Insumo exacto OPS<select value={costItemId} onChange={e=>setCostItemId(e.target.value)}>
         <option value="">Elige un insumo…</option>
         {rows.map(x=><option key={x.id} value={x.id}>{x.name} · {shopUnit(x.unit)}</option>)}
        </select></label>
        <label>Contenido por presentación (kg, L o pz)
         <input type="number" min="0" step=".001" value={costUnits}
          onChange={e=>setCostUnits(e.target.value)} placeholder="Ej. 12 para 12 L/caja"/></label>
       </div>
       <div className="abp-actions">
        <button type="button" className="abp-button primary" onClick={()=>{
         const p=purchases.find(x=>x.id===costPurchaseId),item=rows.find(x=>x.id===costItemId);
         const count=p?nonnegative(p.amount):null,amount=p?nonnegative(p.price):null,
           per=nonnegative(costUnits);
         if(!p||!item||count===null||count<=0||amount===null||per===null||per<=0){
          setNotice("Elige ticket e insumo y confirma cantidad, importe y contenido por presentación.");
          return;
         }
         const box=amount/count,unit=box/per;
         update(item.id,{chosen:true,unitPrice:unit.toFixed(4),
          boxPrice:box.toFixed(2),boxUnits:String(per),supplier:p.supplier});
         setNotice(item.name+": "+cashFmt.format(box)+"/presentación y "+
          cashFmt.format(unit)+"/"+shopUnit(item.unit)+" (solo preview).");
         setTab("PLAN");
        }}>Aplicar costo al simulador →</button>
       </div>
      </div>
      <div className="abp-actions">
       <button type="button" className="abp-button" onClick={()=>setPurchases(p=>[...p,{
        id:"extra-"+String(Date.now()),name:"",amount:"",presentation:"pz",supplier:"",price:""
       }])}>+ Otra línea</button>
      </div>
      <div className="abp-summary">
       <span>Importes conocidos: <strong>{cashFmt.format(purchasesKnown)}</strong></span>
       <span>Líneas sin importe: <strong>{purchaseMissing}</strong></span>
       <span>Líneas sin cantidad: <strong>{purchaseMissingQty}</strong></span>
       <span>Compras conocidas + traslado completo:
         <strong> {moneyOrUnknown(transportTotal)}</strong></span>
      </div>
    </div>
    <div className="abp-panel">
      <h2>Checklist de recepción del próximo plan</h2>
      <p className="abp-lead">Simulación de recepción separada de la compra planeada.
        Una recepción real deberá confirmar cantidades, lote, caducidad y comprobante,
        y crear una entrada idempotente al inventario OPS.</p>
      <div className="abp-list">
       {funded.map(d=><label key={d.line.id} className="abp-stop" style={{display:"flex",flexDirection:"row"}}>
        <input type="checkbox" checked={Boolean(received[d.line.id])}
         onChange={e=>setReceived(x=>({...x,[d.line.id]:e.target.checked}))}
         style={{width:18,height:18}}/>
        <span style={{flex:1}}><strong>{d.line.name}</strong>
         <span className="abp-muted" style={{display:"block"}}>
          {fmtUnits(d.units,d.line.unit)} · {showPrice(d.estimatedCost)} · {d.mode}</span></span>
        <span className="abp-chip">{received[d.line.id]?"Revisado (simulado)":"Sin verificar"}</span>
       </label>)}
       {funded.length===0&&<p className="abp-muted">No hay compras financiables para revisar.
        Completa precios, cantidades, presupuesto y traslado en las otras pestañas.</p>}
      </div>
      <p className="abp-foot">Revisados: {funded.filter(d=>received[d.line.id]).length}/{funded.length}.
       Ni marcar ni desmarcar afecta compras, saldos ni caja.</p>
    </div>
   </section>}
  {tab==="REGLAS"&&<section className="abp-two">
   <div className="abp-panel">
    <h2>Reglas de decisión implementadas</h2>
    <div className="abp-list">
     <div className="abp-summary"><strong>1. Perecederos como ancla semanal</strong>
      <span>Pronóstico a {weekDays} días o a vida útil menor si se conoce. No llenar
       cámaras con stock que podría caducar.</span></div>
     <div className="abp-summary"><strong>2. Reserva de efectivo no gastable</strong>
      <span>Dinero para mercancía = presupuesto − reserva − viaje.
       Las cantidades y precios faltantes se reportan como pendientes.</span></div>
     <div className="abp-summary"><strong>3. Prioridad por urgencia</strong>
      <span>Primero los insumos agotados o insuficientes hasta la próxima salida,
       luego perecederos semanales y productos estables.</span></div>
     <div className="abp-summary"><strong>4. Caja solo después del gasto esencial</strong>
      <span>Se examina el menor costo unitario y la vida útil. Un ahorro por unidad no
       justifica por sí solo descapitalizar la cafetería.</span></div>
     <div className="abp-summary"><strong>5. Compras parciales señaladas</strong>
      <span>Si la compra completa no cabe, se ofrece cantidad fraccionada cuando
       existe un precio suelto válido, dejando visible lo faltante.</span></div>
     <div className="abp-summary"><strong>6. Operaciones separadas</strong>
      <span>Plan → compra → pago → recepción → consumo de receta. Un mismo gasto
       no debe duplicarse como salida financiera ni costo de ventas.</span></div>
    </div>
   </div>
   <div className="abp-stacked">
    <div className="abp-panel">
     <h2>Calidad de datos</h2>
     <p>Insumos provenientes del inventario nativo: <strong>{seeds.length}</strong></p>
     <p>Días de ventas LIVE observados: <strong>{observedDays}</strong></p>
     <p>Sin precio dentro de la selección: <strong>{decisions.missingPrices}</strong></p>
     <p>Sin pronóstico/cantidad confirmable: <strong>{decisions.missingForecasts}</strong></p>
     <p className="abp-foot">No incorporamos ubicación geográfica verificada,
      precios de proveedor reales, caducidades desconocidas o inventario de café verde
      no conciliado. Se configurarán como registros propios antes de producción.</p>
    </div>
    <div className="abp-panel">
      <h2>Qué faltará para integración productiva</h2>
      <p className="abp-lead">Órdenes de compra persistentes, lotes, recepciones parciales,
       permisos, proveedores con ubicaciones, conciliación de gastos y prueba de concurrencia.
       El motor actual es una propuesta operativa, no una orden automatizada.</p>
      <pre className="abp-code">{JSON.stringify({
        date:tripDate||null,cycleDays:weekDays,selected:chosen,tripKm:routeKm||null,
        estimatedSpend:decisions.unknownBudget?null:decisions.estimatedSpend,
        travelCost:travel.cashCost,missingPrices:decisions.missingPrices,
        missingForecasts:decisions.missingForecasts,receipts:funded.filter(d=>received[d.line.id]).length
      },null,2)}</pre>
    </div>
   </div>
  </section>}
 </>;
}
