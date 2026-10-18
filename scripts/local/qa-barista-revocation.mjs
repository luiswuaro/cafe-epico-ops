/**
 * Prueba QA de revocación reversible. Únicamente modifica el empleado
 * sintético BARISTA de la organización cafe-epico-qa en PostgreSQL local.
 *
 * Uso:
 *   node --env-file=.env.local scripts/local/qa-barista-revocation.mjs --status
 *   node --env-file=.env.local scripts/local/qa-barista-revocation.mjs --disable
 *   node --env-file=.env.local scripts/local/qa-barista-revocation.mjs --enable
 *
 * No desactiva usuarios de auth.users ni toca empleados comerciales.
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

const [action,...extra]=process.argv.slice(2);
const actions=new Set(["--status","--disable","--enable"]);
function stop(){throw Error("BLOQUEADO: identidad BARISTA QA o estado inesperado. No cambiar nada.");}

async function main(){
 const guard=validateLocalQaConfig(process.env);
 if(!guard.ok||!actions.has(action)||extra.length)stop();
 const db=postgres(process.env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 try{
  await db.begin(async tx=>{
   const [scope]=await tx`select
     (select count(*)::int from public.organizations) as orgs,
     (select count(*)::int from public.stores) as stores,
     (select id from public.organizations where slug='cafe-epico-qa') as qa_org`;
   if(scope?.orgs!==1||scope?.stores!==1||!scope.qa_org)stop();

   // Fijar empleado, rol y organización; bloquear su fila en esta transacción.
   const employees=await tx`
    select e.id,e.user_id,e.is_active
    from public.employees e
    join public.employee_roles er on er.employee_id=e.id
    join public.roles r on r.id=er.role_id and r.organization_id=e.organization_id
    where e.organization_id=${scope.qa_org}
      and e.name='Azucena' and r.code='BARISTA'
    for update of e`;
   if(employees.length!==1||!employees[0].user_id)stop();
   const employee=employees[0];
   const [auth]=await tx`select exists(
    select 1 from auth.users where id=${employee.user_id}::uuid
      and email='barista-qa@example.test'
   ) as linked`;
   if(auth?.linked!==true)stop();

   const [owner]=await tx`select count(distinct e.id)::int as count
     from public.employees e
     join public.employee_roles er on er.employee_id=e.id
     join public.roles r on r.id=er.role_id and r.organization_id=e.organization_id
     where e.organization_id=${scope.qa_org} and r.code='OWNER'
     and e.is_active=true and e.user_id is not null`;
   if(owner?.count!==1)stop();

   if(action==="--status"){
    console.log("PASS: BARISTA QA activo="+employee.is_active+"; Auth vinculado; OWNER intacto.");
    return;
   }
   const before=action==="--disable",after=!before;
   if(employee.is_active!==before)stop();
   const changed=await tx`update public.employees set is_active=${after}
     where id=${employee.id} and organization_id=${scope.qa_org}
       and is_active=${before} returning id`;
   if(changed.length!==1)stop();
   console.log("PASS: BARISTA QA "+(after?"REACTIVADO":"DESACTIVADO")+
     "; otras cuentas sin cambios.");
  });
 }finally{await db.end({timeout:3})}
}
main().catch(()=>{
 console.error("BLOQUEADO: prueba QA detenida; verifica el estado antes de reintentar.");
 process.exitCode=1;
});
