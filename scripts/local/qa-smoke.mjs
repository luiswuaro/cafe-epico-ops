// Auditoría de QA sin escritura SQL y sin imprimir contraseñas.
// Uso: node --env-file=.env.local scripts/local/qa-smoke.mjs [--db-only]
import postgres from "postgres";
import {request} from "node:https";
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import {migrationPlan} from "./qa-sql-plan.mjs";
import {CRITICAL_QA_TABLES,assessQaSnapshot} from "./qa-readiness-policy.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const boundedInt=(value)=>{const n=Number(value);return Number.isFinite(n)?n:0};
function assert(ok,message){if(!ok)throw Error(message)}

function httpsGet(url,apiKey){
 return new Promise((resolve,reject)=>{
   const caPath=process.env.OPS_LOCAL_CA_FILE;
   const opts={headers:apiKey?{apikey:apiKey}:{},timeout:8000};
   if(caPath)opts.ca=readFileSync(caPath);
   const req=request(url,opts,res=>{
     res.resume();res.on("end",()=>resolve(res.statusCode));
   });
   req.on("timeout",()=>req.destroy(new Error("TLS timeout")));
   req.on("error",reject);req.end();
 });
}

async function main(){
 const guard=validateLocalQaConfig(process.env);
 assert(guard.ok,"Configuración QA inválida: "+guard.errors.join("; "));
 const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:6,idle_timeout:3});
 try {
   const names=CRITICAL_QA_TABLES.map(x=>x.replace(/^public\./,""));
   const present=await db`select tablename from pg_tables
     where schemaname='public' and tablename = any(${names}::text[])`;
   const [org,store,migrations,users,counts]=await Promise.all([
     db`select id,slug from public.organizations order by slug`,
     db`select organization_id as "organizationId",code from public.stores order by code`,
     db`select name,sha256 from public.ops_local_migrations order by name`,
     db`select count(*)::int as total from auth.users`,
     db`select count(*)::int as orders,
       count(*) filter (where mode='LIVE' and not (
         client_order_id like 'local-agent-qa-%'
         and subtotal=0 and total=0 and status='SENT'
         and note='PRUEBA DE IMPRESORA - SIN VENTA REAL'
       ))::int as live
       from public.pos_orders`,
   ]);
   const expected=migrationPlan(join(root,"db/migrations")).map(({name,sha256})=>({name,sha256}));
   const snapshots=await db`
     select jsonb_array_length(items) as items_count,
       jsonb_array_length(variants) as variants_count,
       jsonb_array_length(categories) as categories_count
     from public.ops_catalog_archive_snapshots
     where organization_id=${org[0]?.id ?? "00000000-0000-0000-0000-000000000000"}
   `;
   assert(snapshots.length===1,
     "Falta la copia del catálogo QA; ejecutar repair-qa-catalog-snapshot.mjs.");
   const [catalogCount]=await db`
     select count(*)::int as total from public.pos_manual_products
     where organization_id=${org[0].id} and is_active=true
   `;
   if(snapshots[0].items_count===0 && catalogCount.total===0)
     console.log("PENDIENTE: catálogo QA estructural vacío; aún no hay menú utilizable.");
   const result=assessQaSnapshot({
     presentTables:present.map(x=>"public."+x.tablename),
     expectedMigrations:expected,appliedMigrations:migrations,
     organizations:org,stores:store,authUsers:boundedInt(users[0]?.total),
     orders:boundedInt(counts[0]?.orders),liveOrders:boundedInt(counts[0]?.live),
   });
   for(const warning of result.warnings)console.log("PENDIENTE: "+warning);
   for(const error of result.errors)console.error("ERROR: "+error);
   assert(result.ok,"La estructura QA no cumple los requisitos.");
   console.log("PASS: "+expected.length+" migraciones compatibles, "+present.length+" tablas críticas, organización y sucursal QA aisladas.");
 }finally {await db.end({timeout:3});}
 if(process.argv.includes("--db-only")){
   console.log("PASS: PostgreSQL QA comprobado. HTTPS/OPS aún no se comprobaron.");
   return;
 }
 const origin=process.env.APP_ORIGIN.replace(/\/$/,"");
 const endpoints=[
   {name:"OPS",url:origin+"/api/health",key:null},
   {name:"Auth local",url:origin+"/auth/v1/health",key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},
 ];
 for(const endpoint of endpoints){
   const status=await httpsGet(endpoint.url,endpoint.key);
   assert(status===200,endpoint.name+": respuesta HTTPS "+status+", esperada 200.");
   console.log("PASS: "+endpoint.name+" HTTPS 200 con verificación de certificado.");
 }
 console.log("PASS: infraestructura QA y HTTPS local validados. Aún falta ensayo de cobros e impresión.");
}
main().catch(error=>{
 // No imprimir detalles de conexión o errores SQL que puedan incluir credenciales.
 const safe=error instanceof Error?error.message:"Error desconocido";
 if(safe.includes("postgresql://")||safe.includes("password")||safe.includes("DATABASE_URL="))
   console.error("BLOQUEADO: conexión QA no disponible; revisar configuración local.");
 else console.error("BLOQUEADO: "+safe.slice(0,300));
 process.exitCode=1;
});
