/**
 * CI ONLY: creates the minimal Supabase Auth shape/roles needed for the OPS SQL
 * migration smoke test. This is NOT an Auth implementation for the real POS.
 * Refuses execution outside GitHub Actions or against non-loopback PostgreSQL.
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

async function main(){
  if(process.env.GITHUB_ACTIONS!=="true"||process.env.OPS_CI_DB_TEST!=="true")
    throw Error("Sólo puede ejecutarse dentro del trabajo sintético de GitHub Actions.");
  const config=validateLocalQaConfig(process.env);
  if(!config.ok)throw Error("El entorno de prueba no está aislado.");
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
    throw Error("CI sólo permite PostgreSQL local temporal.");
  const db=postgres(process.env.DATABASE_URL,{prepare:false,max:1});
  try {
    const [check]=await db`select current_database() as name,
      to_regclass('public.organizations')::text as existing`;
    if(check.name!=="postgres"||check.existing)
      throw Error("El contenedor CI no está vacío: ejecución detenida.");
    await db.unsafe("create schema if not exists auth");
    await db.unsafe(`create table auth.users (
      id uuid primary key default gen_random_uuid()
    )`);
    await db.unsafe(`do $$
      begin
        if not exists (select 1 from pg_roles where rolname='anon')
          then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated')
          then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role')
          then create role service_role nologin; end if;
      end $$`);
    console.log("PASS: PostgreSQL CI sintético con auth.users mínima y roles sin login.");
  }finally{await db.end({timeout:3});}
}
main().catch(()=>{
  console.error("BLOQUEADO: el contenedor de PostgreSQL CI no está aislado o no está listo.");
  process.exitCode=1;
});
