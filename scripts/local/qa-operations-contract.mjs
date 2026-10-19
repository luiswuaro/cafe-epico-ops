import assert from "node:assert/strict";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import {seedQaOperations,closingTasks} from "./seed-qa-operations.mjs";

const env=process.env;
const target=new URL(env.DATABASE_URL??"");
assert.equal(env.GITHUB_ACTIONS,"true");
assert.equal(env.OPS_CI_DB_TEST,"true");
assert.ok(validateLocalQaConfig(env).ok);
assert.equal(target.hostname,"127.0.0.1");
assert.equal(target.pathname,"/postgres");

const db=postgres(env.DATABASE_URL,{max:1,prepare:false});
try{
 const first=await seedQaOperations(db);
 const second=await seedQaOperations(db);
 assert.equal(first.totalClosing,closingTasks.length);
 assert.equal(second.insertedClosing,0,"Plantilla de cierre debe ser idempotente");
 const [data]=await db`
   select
     count(*)::int as tasks,
     count(*) filter(where t.assigned_role_id is not null)::int as assigned,
     count(*) filter(where t.is_required)::int as required
   from public.checklist_tasks t
   join public.checklist_templates p on p.id=t.checklist_template_id
   join public.stores s on s.id=p.store_id
   join public.organizations o on o.id=p.organization_id
   where o.slug='cafe-epico-qa' and s.code='QA-TEPEXI'
   and p.shift_type='CLOSING'`;
 assert.deepEqual(data,{tasks:closingTasks.length,assigned:closingTasks.length,
   required:closingTasks.length});
 const [older]=await db`
   select count(*)::int as n from public.checklist_tasks t
   join public.checklist_templates p on p.id=t.checklist_template_id
   where p.shift_type='MORNING'
     and t.title ilike '%Loyverse%' `;
 assert.equal(older.n,0,"Apertura local no debe mencionar Loyverse");
 const access=await db`
  select p.code from public.role_permissions rp
  join public.permissions p on p.id=rp.permission_id
  join public.roles r on r.id=rp.role_id
  join public.organizations o on o.id=r.organization_id
  where o.slug='cafe-epico-qa' and r.code='BARISTA'`;
 const permissions=new Set(access.map(x=>x.code));
 for(const code of ["checklist.execute","pos.sell"])
   assert.ok(permissions.has(code),"Permiso requerido: "+code);
 for(const code of ["financial.read","admin.access","checklist.manage"])
   assert.ok(!permissions.has(code),"Permiso restringido: "+code);
 console.log("PASS: 8 tareas de cierre, idempotencia, inicio OPS sin Loyverse, BARISTA sin finanzas/admin.");
}finally{await db.end({timeout:3})}
