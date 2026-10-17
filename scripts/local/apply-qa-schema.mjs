// Ejecutar SOLAMENTE con .env.local que pasó guard-qa-config y con Supabase QA aislado.
// Aplica cada migración en una transacción y registra SHA-256; jamás restaura
// sobre una base comercial ni asume que un schema de producción es reproducible
// con este seed de prueba.
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import {migrationPlan,qaSeed,checksum} from "./qa-sql-plan.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
function fail(message){throw new Error(message)}
async function main(){
  const validation=validateLocalQaConfig(process.env);
  if(!validation.ok)fail("Configuración QA no autorizada: "+validation.errors.join("; "));
  const files=migrationPlan(join(root,"db/migrations"));
  if(files.length<25)fail("Faltan migraciones del OPS. Operación cancelada.");
  const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,
    idle_timeout:2,connect_timeout:5});
  try{
    const [identity]=await db`
      select current_database() as name,
        to_regclass('public.organizations')::text as organizations,
        to_regclass('public.ops_local_migrations')::text as ledger
    `;
    if(identity.name!=="postgres") fail("Base inesperada: sólo se permite postgres de la pila QA.");
    if(identity.organizations && !identity.ledger)
      fail("Existen tablas OPS sin historial de migraciones: NO sobrescribir ni ejecutar el seed.");

    await db.unsafe(`create table if not exists public.ops_local_migrations (
      name text primary key,
      sha256 char(64) not null,
      applied_at timestamptz not null default now()
    )`);
    const existing=await db`select name,sha256 from public.ops_local_migrations`;
    const applied=new Map(existing.map(x=>[x.name,x.sha256.trim()]));
    const seedName="qa-seed-v1";
    if(applied.has(seedName) && files.some(f=>!applied.has(f.name)))
      fail("Seed QA ya existe pero hay migraciones sin aplicar. Revisar plan antes de continuar.");
    for (const f of files){
      if(applied.has(f.name)){
        if(applied.get(f.name)!==f.sha256)
          fail("La migración "+f.name+" cambió de contenido. Revisión manual obligatoria.");
        continue;
      }
      await db.begin(async tx=>{
        await tx.unsafe(f.content);
        await tx`insert into public.ops_local_migrations(name,sha256)
          values(${f.name},${f.sha256})`;
      });
      console.log("Aplicada: "+f.name);
    }
    if(process.argv.includes("--seed-qa") && !applied.has(seedName)){
      const seed=qaSeed(readFileSync(join(root,"db/seed.sql"),"utf8"));
      const hash=checksum(seed);
      await db.begin(async tx=>{
        await tx.unsafe(seed);
        await tx`insert into public.ops_local_migrations(name,sha256)
          values(${seedName},${hash})`;
      });
      console.log("Aplicado seed sintético QA; no se insertaron ventas de producción.");
    }
    console.log("PASS: esquema QA registrado; pendiente alta de usuarios Auth y pruebas de extremo a extremo.");
  } finally {await db.end({timeout:3});}
}
main().catch(error=>{
  console.error("BLOQUEADO: "+(error instanceof Error?error.message:"error de migración"));
  process.exitCode=1;
});
