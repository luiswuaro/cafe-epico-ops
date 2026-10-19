import {NextResponse} from "next/server";
import {sql} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** La sonda local no declara lista una PC con PostgreSQL apagado.
 * La ruta no muestra cadenas de conexión, nombres de bases ni credenciales.
 */
export async function GET(){
 if(process.env.OPS_LOCAL_FIRST==="true"&&process.env.OPS_QA_MODE==="true"){
   try{
     await getDb().execute(sql`select 1 as ready`);
     return NextResponse.json({ok:true,service:"cafe-epico-ops",
       version:"0.1.0",database:"ready"},{headers:{"Cache-Control":"no-store"}});
   }catch{
     return NextResponse.json({ok:false,service:"cafe-epico-ops",
       version:"0.1.0",database:"unavailable"},
       {status:503,headers:{"Cache-Control":"no-store"}});
   }
 }
 return NextResponse.json({ok:true,service:"cafe-epico-ops",
   version:"0.1.0"},{headers:{"Cache-Control":"no-store"}});
}
