import {NextRequest,NextResponse} from "next/server";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {referencePlaceSearch,type PlaceMatch} from "@/src/domain/purchases/place-references";
export const dynamic="force-dynamic";
type Period={open?:{day?:number;hour?:number;minute?:number};close?:{day?:number;hour?:number;minute?:number}};
type GooglePlace={id?:string;displayName?:{text?:string};formattedAddress?:string;googleMapsUri?:string;
 regularOpeningHours?:{periods?:Period[];weekdayDescriptions?:string[]};
 addressComponents?:{longText?:string;shortText?:string;types?:string[]}[]};
function time(hour?:number,minute?:number){
 return typeof hour==="number"&&Number.isInteger(hour)&&hour>=0&&hour<=23?
  String(hour).padStart(2,"0")+":"+String(minute??0).padStart(2,"0"):"";
}
function normalize(result:GooglePlace):PlaceMatch|null{
 if(!result.displayName?.text||!result.id||!result.formattedAddress)return null;
 const periods=result.regularOpeningHours?.periods??[];
 const valid=periods.filter(x=>x.open&&x.close&&x.open.day===x.close.day);
 const sameOpening=new Set(valid.map(x=>time(x.open!.hour,x.open!.minute)));
 const sameClosing=new Set(valid.map(x=>time(x.close!.hour,x.close!.minute)));
 const simple=valid.length>=5&&valid.length<=7&&sameOpening.size===1&&sameClosing.size===1;
 const opening=simple?time(valid[0].open?.hour,valid[0].open?.minute):"";
 const closing=simple?time(valid[0].close?.hour,valid[0].close?.minute):"";
 const days=[...new Set(valid.map(p=>p.open?.day).filter((d):d is number=>typeof d==="number"))].sort();
 const postal=result.addressComponents?.find(x=>x.types?.includes("postal_code"))?.longText??"";
 return {placeId:result.id,name:result.displayName.text,
  address:result.formattedAddress,postal,opening,closing,openDays:days.join(""),
  mapsUrl:result.googleMapsUri||"https://www.google.com/maps/search/?api=1&query="+
   encodeURIComponent(result.displayName.text+" "+result.formattedAddress)+
   "&query_place_id="+encodeURIComponent(result.id),
  source:"GOOGLE_PLACES",
  hoursNote:simple?"Horario habitual obtenido desde Google Places, sujeto a excepciones.":
   "Horario variable: revisar detalle de apertura por día en Google Maps."
 };
}
export async function GET(req:NextRequest){
 await requirePermission("purchase.manage");
 const q=req.nextUrl.searchParams.get("q")?.trim()??"";
 if(q.length<3||q.length>100)return NextResponse.json({error:"Consulta de 3 a 100 caracteres."},{status:400});
 const fallback=referencePlaceSearch(q);
 const apiKey=process.env.GOOGLE_MAPS_API_KEY;
 if(!apiKey)return NextResponse.json({places:fallback,mode:"DIRECTORIO",
  message:"Sin Google Maps Platform habilitado: resultados de referencia (no datos en vivo)."},
  {headers:{"Cache-Control":"private, no-store"}});
 try{
  const response=await fetch("https://places.googleapis.com/v1/places:searchText",{
   method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":apiKey,
    "X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.addressComponents,places.googleMapsUri,places.regularOpeningHours"},
   body:JSON.stringify({textQuery:q+" Puebla México",languageCode:"es",regionCode:"MX",pageSize:8}),
   cache:"no-store",signal:AbortSignal.timeout(9000)
  });
  if(!response.ok)throw Error("Places HTTP "+response.status);
  const data=await response.json() as {places?:GooglePlace[]};
  const places=(data.places??[]).map(normalize).filter((x):x is PlaceMatch=>x!==null);
  return NextResponse.json({places,mode:"GOOGLE_PLACES",
   message:"Resultados Google Places. Verificar horarios especiales y sucursal seleccionada."},
   {headers:{"Cache-Control":"private, no-store"}});
 }catch{
  return NextResponse.json({places:fallback,mode:"DIRECTORIO",
   message:"No se pudo consultar Google Places; mostrando referencias públicas, no datos vivos."},
   {headers:{"Cache-Control":"private, no-store"}});
 }
}
