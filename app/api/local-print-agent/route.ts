import {NextRequest,NextResponse} from "next/server";
import {and,eq} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {employees,organizations} from "@/src/infrastructure/db/schema";
import {employeeHasPermission} from "@/src/infrastructure/auth/permissions";
import {withLocalPrintAgent} from "@/src/infrastructure/auth/local-print-agent-context";
import {validLocalPrintToken} from "@/src/domain/pos/local-print-agent-auth";
import {getPrintStationJobs,claimPrintStationJob,finishPrintStationJob,
  heartbeatPrintStation,getPrintStationTemplate} from "@/app/(employee)/pos/printer/hub-actions";
import {acknowledgeKitchenPrint} from "@/app/(employee)/pos/orders/print-timing-actions";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const denied=()=>NextResponse.json({error:"Acceso denegado"},{status:403,headers:{"Cache-Control":"no-store"}});

export async function POST(request:NextRequest){
 // Sólo el proceso Node de la PC, nunca Cloud/Vercel. Nada de mutaciones LIVE
 // en el piloto. Desplegar en producción requiere autorización posterior.
 if(process.env.OPS_LOCAL_FIRST!=="true"||process.env.OPS_QA_MODE!=="true"||
    process.env.POS_LIVE_ENABLED==="true"||
    process.env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa"||
    process.env.DEFAULT_STORE_CODE!=="QA-TEPEXI"||
    process.env.VERCEL||process.env.VERCEL_ENV)return denied();
 // La validación de identidad QA no basta si alguien apunta la URL de DB
 // por error a Supabase comercial. Fail closed ANTES de consultar cualquier
 // tabla, incluso si el token es correcto.
 let dbUrl:URL;
 try{dbUrl=new URL(process.env.DATABASE_URL??"");}catch{return denied();}
 if(!["postgres:","postgresql:"].includes(dbUrl.protocol)||
    !["127.0.0.1","localhost","[::1]"].includes(dbUrl.hostname))
    return denied();
 const host=request.headers.get("host")??"";
 if(!/^((127\.0\.0\.1)|(localhost)):3000$/i.test(host) ||
    request.headers.has("origin"))return denied();
 if(!validLocalPrintToken(request.headers.get("authorization"),
   process.env.OPS_LOCAL_PRINT_AGENT_TOKEN))return denied();
 if(Number(request.headers.get("content-length")??0)>8192)
   return NextResponse.json({error:"Solicitud demasiado grande"},{status:413});
 const actorId=process.env.OPS_LOCAL_PRINT_AGENT_USER_ID;
 if(!actorId||!/^[0-9a-f-]{36}$/i.test(actorId))return denied();
 const db=getDb();
 const [actor]=await db.select({employee:employees}).from(employees)
   .innerJoin(organizations,eq(organizations.id,employees.organizationId))
   .where(and(eq(employees.userId,actorId),eq(employees.isActive,true),
     eq(organizations.slug,"cafe-epico-qa"))).limit(1);
 if(!actor?.employee?.homeStoreId||
    !(await employeeHasPermission(actor.employee.id,"pos.sell",actor.employee.homeStoreId)))
   return denied();
 let input:Record<string,unknown>;
 try{
   const raw=await request.text();
   if(raw.length>8192)throw new Error("large");
   const parsed=JSON.parse(raw) as unknown;
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("invalid");
   input=parsed as Record<string,unknown>;
 }catch{return NextResponse.json({error:"Solicitud inválida"},{status:400});}
 try{
   const result=await withLocalPrintAgent({
     user:{id:actorId,email:null},employee:actor.employee,
   },async()=>{
     if(input.op==="POLL"){
       if(typeof input.since!=="string"||typeof input.lastVersion!=="string")
         throw Error("Consulta inválida");
       const feed=await getPrintStationJobs({since:input.since,lastVersion:input.lastVersion});
       const jobs=Array.isArray(feed)?feed:feed.jobs;
       return {jobs,version:Array.isArray(feed)?"":feed.version,
         template:jobs.length?await getPrintStationTemplate():null};
     }
     if(input.op==="CLAIM"){
       if(typeof input.jobKey!=="string"||typeof input.stationId!=="string")
         throw Error("Trabajo inválido");
       return {claimed:await claimPrintStationJob(input.jobKey,input.stationId)};
     }
     if(input.op==="FINISH"){
       if(typeof input.jobKey!=="string"||typeof input.stationId!=="string"||
          !["DONE","FAILED"].includes(String(input.outcome))||
          typeof input.details!=="string")throw Error("Estado inválido");
       await finishPrintStationJob(input.jobKey,input.stationId,
         input.outcome as "DONE"|"FAILED",input.details);
       return {ok:true};
     }
     if(input.op==="ACK"){
       if(typeof input.orderId!=="string"||typeof input.roundId!=="string"||
          typeof input.printer!=="string")throw Error("Acuse inválido");
       await acknowledgeKitchenPrint({orderId:input.orderId,
         roundId:input.roundId,printer:input.printer});
       return {ok:true};
     }
     if(input.op==="HEARTBEAT"){
       if(typeof input.stationId!=="string"||typeof input.since!=="string"||
          typeof input.bridgeReady!=="boolean")throw Error("Latido inválido");
       await heartbeatPrintStation({stationId:input.stationId,
         since:input.since,bridgeReady:input.bridgeReady});
       return {ok:true};
     }
     throw Error("Operación inválida");
   });
   return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch{
   // Nada de detalles de empleados, DB o trabajos en respuestas a clientes.
   return NextResponse.json({error:"Operación rechazada"},{status:400,
     headers:{"Cache-Control":"no-store"}});
 }
}
