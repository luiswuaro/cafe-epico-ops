// Corrige únicamente la fila de estructura del archivo de catálogo QA faltante.
// No importa datos comerciales, no modifica precios ni habilita cobros LIVE.
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

async function main(){
  const guard=validateLocalQaConfig(process.env);
  if(!guard.ok) throw Error("Configuración QA inválida: "+guard.errors.join("; "));
  if(process.env.OPS_QA_MODE!=="true"||process.env.POS_LIVE_ENABLED!=="false")
    throw Error("Solo se permite QA con ventas LIVE deshabilitadas.");

  const db=postgres(process.env.DATABASE_URL,{
    max:1,prepare:false,connect_timeout:6,idle_timeout:3,
  });
  try{
    const state=await db.begin(async tx=>{
      const orgs=await tx`select id,slug from public.organizations for update`;
      if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa")
        throw Error("La base contiene organizaciones ajenas a la réplica QA.");
      const [sales]=await tx`select count(*)::int as total from public.pos_orders where mode='LIVE'`;
      if(sales.total!==0)throw Error("Existen pedidos LIVE: QA contaminado, no intervenir.");

      const [current]=await tx`
        select jsonb_typeof(items) as items_type,
          jsonb_typeof(variants) as variants_type,
          jsonb_typeof(categories) as categories_type,
          jsonb_typeof(settings) as settings_type,
          jsonb_typeof(popularity) as popularity_type
        from public.ops_catalog_archive_snapshots
        where organization_id=${orgs[0].id}
      `;
      if(current){
        if(Object.values(current).some(type=>type!=="array"))
          throw Error("Snapshot QA existente con formato inválido; revisar antes de modificar.");
        return "EXISTING";
      }
      await tx`
        insert into public.ops_catalog_archive_snapshots
          (organization_id,items,variants,categories,settings,popularity)
        values (${orgs[0].id},'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
          '[]'::jsonb,'[]'::jsonb)
        on conflict (organization_id) do nothing
      `;
      return "CREATED";
    });
    console.log("PASS: estructura de catálogo QA "+(state==="CREATED"?"creada":"ya existente")+".");
    console.log("PENDIENTE: catálogo comercial NO importado. No realizar cobros ni habilitar ventas LIVE.");
    console.log("No se modificaron los datos de producción, las claves ni los contenedores.");
  }finally{await db.end({timeout:3});}
}
main().catch(error=>{
  const m=error instanceof Error?error.message:"Error desconocido";
  console.error("BLOQUEADO: "+(/password|postgresql:\/\//i.test(m)?"Revisar configuración QA.":m.slice(0,220)));
  process.exitCode=1;
});
