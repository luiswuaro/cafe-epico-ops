// Reparación incremental, solamente PostgreSQL local y organización sintética QA.
// No borra registros, ni altera el contenedor comercial. A diferencia del
// bootstrap, permite migraciones adicionales después de qa-seed-v1.
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import {migrationPlan,qaSeed,checksum} from "./qa-sql-plan.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const targetName="0035_pos_payment_cash_received.sql";
function fail(message){throw new Error("BLOQUEADO: "+message)}
function isExpectedNumeric(row) {
  return row.data_type==="numeric"&&Number(row.numeric_precision)===14&&Number(row.numeric_scale)===2;
}
async function main(){
  const guard=validateLocalQaConfig(process.env);
  if(!guard.ok)fail("Configuración QA inválida: "+guard.errors.join("; "));
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=="127.0.0.1"||url.pathname!=="/postgres")
    fail("Sólo PostgreSQL QA en 127.0.0.1/postgres.");

  const files=migrationPlan(join(root,"db/migrations"));
  const target=files.find(f=>f.name===targetName);
  if(!target||files.at(-1)?.name!==targetName)fail("Plan de migraciones inesperado.");
  const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
  try{
    const [dbIdentity]=await db`select current_database() as name,
      to_regclass('public.ops_local_migrations')::text as ledger,
      to_regclass('public.pos_payments')::text as payments`;
    if(dbIdentity?.name!=="postgres"||!dbIdentity.ledger||!dbIdentity.payments)
      fail("Base o historial QA no encontrados.");

    const orgs=await db`select slug from public.organizations`;
    const stores=await db`select code from public.stores`;
    if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
       stores.length!==1||stores[0].code!=="QA-TEPEXI")
      fail("Organización o sucursal comercial detectada; no se modifica nada.");

    const ledger=await db`select name,trim(sha256) as sha256 from public.ops_local_migrations`;
    const applied=new Map(ledger.map(row=>[row.name,row.sha256]));
    const seedHash=checksum(qaSeed(readFileSync(join(root,"db/seed.sql"),"utf8")));
    if(applied.get("qa-seed-v1")!==seedHash)
      fail("El seed QA no coincide con el registro original.");
    for(const file of files){
      if(file.name===targetName)continue;
      if(applied.get(file.name)!==file.sha256)
        fail("Migración histórica sin verificar: "+file.name);
    }
    const allowed=new Set([...files.map(f=>f.name),"qa-seed-v1"]);
    if(ledger.some(row=>!allowed.has(row.name)))
      fail("Historial de migraciones contiene cambios no esperados.");

    if(applied.has(targetName)){
      if(applied.get(targetName)!==target.sha256)
        fail("La nueva migración tiene una huella diferente.");
    } else {
      await db.begin(async tx=>{
        const rows=await tx`select column_name,data_type,numeric_precision,numeric_scale
          from information_schema.columns
          where table_schema='public' and table_name='pos_payments'
            and column_name in ('tendered_amount','change_amount')`;
        if(rows.some(row=>!isExpectedNumeric(row)))
          fail("Una columna existe con tipo diferente al esperado.");
        await tx.unsafe(target.content).simple();
        await tx`insert into public.ops_local_migrations(name,sha256)
          values(${target.name},${target.sha256})`;
      });
      console.log("Aplicada en QA: "+targetName);
    }
    const columns=await db`select column_name,data_type,numeric_precision,numeric_scale
      from information_schema.columns
      where table_schema='public' and table_name='pos_payments'
        and column_name in ('tendered_amount','change_amount')`;
    if(columns.length!==2||columns.some(row=>!isExpectedNumeric(row)))
      fail("Verificación final de columnas fallida.");
    console.log("PASS: QA pos_payments tiene tendered_amount y change_amount numeric(14,2).");
    console.log("PASS: historial de migraciones íntegro; registros comerciales fuera de este entorno.");
  }finally{
    await db.end({timeout:3});
  }
}
main().catch(error=>{
  const msg=String(error?.message??"Fallo desconocido")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/ig,"[DB]")
    .replace(/[\r\n]+/g," ").slice(0,300);
  console.error(msg.startsWith("BLOQUEADO:")?msg:"BLOQUEADO: "+msg);
  process.exitCode=1;
});
