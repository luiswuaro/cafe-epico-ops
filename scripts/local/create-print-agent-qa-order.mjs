/**
 * Una única comanda sintética LIVE sin cobro, inventario o puntos.
 * SOLO en base QA aislada y con confirmación literal --print-qa-fixture.
 * Ejecutar después de iniciar el agente para que no sea trabajo histórico.
 */
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

async function main(){
 if(!process.argv.includes("--print-qa-fixture"))
   throw Error("Se requiere --print-qa-fixture para generar papel de prueba.");
 const config=validateLocalQaConfig(process.env);
 if(!config.ok)throw Error("El entorno NO está aislado en QA.");
 const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false});
 try{
   const organizations=await db`select id,slug from public.organizations`;
   if(organizations.length!==1||organizations[0].slug!=="cafe-epico-qa")
     throw Error("Sólo se permite una organización QA en la base.");
   const store=await db`select id,code from public.stores where organization_id=${organizations[0].id}`;
   if(store.length!==1||store[0].code!=="QA-TEPEXI")
     throw Error("No existe sucursal QA única.");
   const orderId=randomUUID();
   const clientOrderId="local-agent-qa-"+orderId;
   const folio="QA-"+orderId.slice(0,8);
   const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Mexico_City",
     year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
   const date=parts.year+"-"+parts.month+"-"+parts.day;
   await db.begin(async tx=>{
     await tx`insert into public.pos_orders (
       id,organization_id,store_id,client_order_id,folio,
       mode,status,service_mode,table_label,business_date,subtotal,total,
       paid_at,inventory_effect_applied,loyalty_effect_applied,note
     ) values (
       ${orderId},${organizations[0].id},${store[0].id},${clientOrderId},
       ${folio},'LIVE','SENT','TAKEAWAY',
       'SOLO QA - NO ENTREGAR',${date},0,0,null,false,false,
       'PRUEBA DE IMPRESORA - SIN VENTA REAL'
     )`;
     await tx`insert into public.pos_order_lines(
       organization_id,order_id,catalog_external_id,name_snapshot,
       category_snapshot,unit_price,quantity,line_total,expected_consumption,note
     ) values (
       ${organizations[0].id},${orderId},'qa-print-fixture',
       '*** COMANDA DE PRUEBA ***','BEBIDAS',0,1,0,
       ${JSON.stringify({roundId:"INITIAL",serviceMode:"TAKEAWAY"})}::jsonb,
       'No preparar bebida. Verificar acentos: café, piña, limón.'
     )`;
   });
   console.log("PASS: se creó una comanda ficticia, sin cobro, puntos ni inventario.");
   console.log("Folio de papel QA: "+folio);
   console.log("Revisar que el agente la imprima una sola vez y marque DONE.");
 }finally{await db.end({timeout:3})}
}
main().catch(()=>{
 console.error("BLOQUEADO: base QA no válida o inserción de comanda no permitida.");
 process.exitCode=1;
});
