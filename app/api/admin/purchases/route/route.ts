import {NextRequest,NextResponse} from "next/server";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
export const dynamic="force-dynamic";
type Req={stops?:unknown;optimize?:unknown};
type Leg={duration?:string;distanceMeters?:number};
const secs=(v:string|undefined)=>{
 const match=/^([0-9]+(?:\.[0-9]+)?)s$/.exec(v??"");
 return match?Number(match[1]):null;
};
export async function POST(request:NextRequest){
 await requirePermission("purchase.manage");
 const key=process.env.GOOGLE_MAPS_API_KEY;
 if(!key)return NextResponse.json({error:"Google Routes API no está configurada. Usa el enlace de Maps para calcular tiempos."},{status:503});
 let body:Req;
 try{body=await request.json() as Req;}catch{
  return NextResponse.json({error:"Solicitud inválida."},{status:400});
 }
 const stops=Array.isArray(body.stops)?body.stops:[];
 if(stops.length<1||stops.length>8||stops.some(x=>typeof x!=="string"||x.trim().length<4||x.length>250))
  return NextResponse.json({error:"Se aceptan entre 1 y 8 sucursales con nombre o dirección."},{status:400});
 const home={address:"Tepexi de Rodríguez, Puebla, México"};
 const optimize=body.optimize===true&&stops.length>1;
 try{
  const res=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
      "X-Goog-FieldMask":"routes.legs.duration,routes.legs.distanceMeters,routes.optimizedIntermediateWaypointIndex"},
    body:JSON.stringify({
      origin:home,destination:home,
      intermediates:stops.map(x=>({address:(x as string).trim()})),
      travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE",optimizeWaypointOrder:optimize,
      languageCode:"es-MX",regionCode:"MX"
    }),
    cache:"no-store",signal:AbortSignal.timeout(15000)
  });
  if(!res.ok)throw Error("Google Routes "+res.status);
  const data=await res.json() as {routes?:{legs?:Leg[];optimizedIntermediateWaypointIndex?:number[]}[]};
  const route=data.routes?.[0];
  if(!route?.legs||route.legs.length!==stops.length+1)
    throw Error("Ruta sin tramos consistentes.");
  const seconds=route.legs.map(l=>secs(l.duration));
  if(seconds.some(x=>x===null))throw Error("Duración faltante.");
  const minutes:number[]=seconds.map(sec=>Math.ceil((sec??0)/60));
  const km=route.legs.reduce((a,l)=>a+(l.distanceMeters??0),0)/1000;
  return NextResponse.json({
   order:optimize?route.optimizedIntermediateWaypointIndex??stops.map((_,i)=>i):stops.map((_,i)=>i),
   legMinutes:minutes,returnMinutes:minutes[minutes.length-1],distanceKm:km,
   totalDriveMinutes:minutes.reduce<number>((sum,value)=>sum+value,0),
   source:"GOOGLE_ROUTES",note:"Estimación de Google Routes según las condiciones del cálculo; verificar aperturas y tráfico al salir."
  },{headers:{"Cache-Control":"private, no-store"}});
 }catch{
  return NextResponse.json({error:"No se pudo calcular con Google Routes. Comprueba API habilitada, facturación y direcciones."},{status:502});
 }
}
