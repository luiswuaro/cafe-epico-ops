/** Simulación horaria de paradas: no implica consulta a mapas ni horarios oficiales. */
export type VendorProfile = {
 id:string;name:string;chain:"SAMS"|"WALMART"|"OTRO";address:string;postal:string;
 opening:string;closing:string;openDays:string; notes:string; website:string;
 provenance:"OPS"|"MANUAL"|"PLANTILLA"|"GOOGLE_PLACES"|"DIRECTORIO";
 placeId?:string;mapsUrl?:string;hoursNote?:string;fetchedAt?:string;
};
export type RouteStop={id:string;vendorId:string;legMinutes:string;visitMinutes:string};
export type RouteStep={stop:RouteStop;vendor:VendorProfile;arrival:number|null;start:number|null;
 departure:number|null;wait:number|null;issue:string;};
export const clockToMinutes=(v:string):number|null=>{
 const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);return m?Number(m[1])*60+Number(m[2]):null;
};
export function clock(n:number|null):string {
 if(n===null||!Number.isFinite(n))return "Sin estimación";
 const d=Math.floor(n/1440);
 const h=Math.floor(n%1440/60),m=Math.floor(n%60);
 return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+(d?" (+"+d+" día)":"");
}
export function evaluateRoute(stops:RouteStop[],profiles:VendorProfile[],date:string,leaveAt:string) {
 const start=clockToMinutes(leaveAt);
 const target=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+"T12:00:00"):null;
 const day=target&&!Number.isNaN(target.getTime())?target.getDay():null;
 const vendorMap=new Map(profiles.map(x=>[x.id,x]));
 let time=start;
 const result:RouteStep[]=[];
 for(const stop of stops){
   const vendor=vendorMap.get(stop.vendorId);
   if(!vendor)continue;
   const leg=stop.legMinutes.trim()===""?null:Number(stop.legMinutes);
   const service=stop.visitMinutes.trim()===""?null:Number(stop.visitMinutes);
   const travel=leg!==null&&Number.isFinite(leg)&&leg>=0?leg:null;
   const visit=service!==null&&Number.isFinite(service)&&service>=0?service:null;
   const arrival=time!==null&&travel!==null?time+travel:null;
   const open=clockToMinutes(vendor.opening),close=clockToMinutes(vendor.closing);
   const active=day!==null&&vendor.openDays.includes(String(day));
   let issue="";
   if(day===null)issue="Define fecha para revisar días de apertura.";
   else if(!vendor.openDays)issue="Días de apertura pendientes de confirmar.";
   else if(!active)issue="La sucursal figura cerrada este día (según datos capturados).";
   if(open===null||close===null)issue+=(issue?" ":"")+"Horario de apertura/cierre sin verificar.";
   if(travel===null)issue+=(issue?" ":"")+"Falta tiempo de traslado desde parada anterior.";
   const begun=arrival!==null&&open!==null?Math.max(arrival,open):arrival;
   const waiting=arrival!==null&&begun!==null?Math.max(0,begun-arrival):null;
   if(begun!==null&&close!==null&&begun>=close)
     issue+=(issue?" ":"")+"Llegada fuera de horario.";
   if(begun!==null&&close!==null&&visit!==null&&begun+visit>close)
     issue+=(issue?" ":"")+"Salida posterior al cierre.";
   const departure=begun!==null&&visit!==null?begun+visit:null;
   result.push({stop,vendor,arrival,start:begun,departure,wait:waiting,issue});
   time=departure;
 }
 return {steps:result,endTime:time,allTimesKnown:start!==null&&result.every(x=>x.departure!==null),
   warnings:result.filter(x=>x.issue).length};
}
export function reorderByClosingTime(stops:RouteStop[],vendors:VendorProfile[]) {
 const byId=new Map(vendors.map(v=>[v.id,v]));
 // Heurística sencilla, NO optimización de kilómetros.
 return [...stops].sort((a,b)=>{
  const vA=byId.get(a.vendorId),vB=byId.get(b.vendorId);
  const closeA=vA?clockToMinutes(vA.closing):null,closeB=vB?clockToMinutes(vB.closing):null;
  return (closeA??1440)-(closeB??1440)||
    (vA?.name??"").localeCompare(vB?.name??"","es");
 }).map(s=>({...s,legMinutes:""}));
}
