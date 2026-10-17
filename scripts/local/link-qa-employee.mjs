/**
 * Vincula un usuario Supabase Auth LOCAL existente al empleado sintético QA.
 * Nunca crea ni comparte contraseñas, nunca toca el personal comercial.
 * Ejecutar con --user UUID --role BARISTA|OWNER después de crear Auth local.
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const args=process.argv.slice(2);
function named(key){const i=args.indexOf(key);return i>=0?args[i+1]:null}
const id=named("--user"),role=named("--role");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(){throw Error("Rechazado: el usuario Auth debe existir en QA y no estar vinculado a otra persona.")}
async function main(){
 const guard=validateLocalQaConfig(process.env);
 if(!guard.ok||!uuid.test(id??"")||!["BARISTA","OWNER"].includes(role))fail();
 const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 try{
  const [org]=await db`select id from public.organizations where slug='cafe-epico-qa'`;
  const [ct]=await db`select
   (select count(*)::int from public.organizations) as orgs,
   (select count(*)::int from public.stores) as stores`;
  if(!org||ct.orgs!==1||ct.stores!==1)fail();
  await db.begin(async tx=>{
   const [user]=await tx`select id from auth.users where id=${id}::uuid`;
   if(!user)fail();
   const [employee]=await tx`select e.id,e.name,e.user_id
      from public.employees e
      where e.organization_id=${org.id}
        and e.name=${role==="BARISTA"?"Azucena":"Propietario principal"}
        and e.is_active=true for update`;
   if(!employee)fail();
   const [roleRow]=await tx`select er.employee_id as id from public.employee_roles er
     join public.roles r on r.id=er.role_id
     where er.employee_id=${employee.id} and r.organization_id=${org.id}
       and r.code=${role}`;
   if(!roleRow)fail();
   const [occupied]=await tx`select id from public.employees
      where user_id=${id}::uuid and id<>${employee.id}`;
   if(occupied||employee.user_id && employee.user_id!==id)fail();
   if(employee.user_id!==id)await tx`update public.employees
     set user_id=${id}::uuid where id=${employee.id} and user_id is null`;
  });
  console.log("PASS: cuenta Auth QA existente vinculada al rol "+role+".");
  console.log("Verifica que al entrar al OPS QA sólo se vean módulos permitidos.");
 }finally{await db.end({timeout:3})}
}
main().catch(()=>{
 console.error("BLOQUEADO: vínculo QA no efectuado. Comprueba usuario, rol y base exclusivamente local.");
 process.exitCode=1;
});
