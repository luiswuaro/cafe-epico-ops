/**
 * Completa las plantillas de operación QA: apertura OPS, entrega y cierre.
 * Sólo PostgreSQL loopback, única organización y tienda sintéticas.
 * Seguro para repetirse; NO ejecuta nada en Supabase comercial.
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";

export const closingTasks=[
 ["Cierre de comandas y mesas pendientes","POS",10,"BOOLEAN",
  "Confirmar pedidos listos; no cancelar ni cobrar cuentas por este checklist."],
 ["Verificar pagos y cortes en OPS","Caja",20,"BOOLEAN",
  "Solo revisión operativa; el cierre de caja se realiza desde su módulo autorizado."],
 ["Limpiar grupos, portafiltros y lanza de vapor","Espresso",30,"BOOLEAN",
  "Utilizar el SOP del equipo y confirmar lavado seguro."],
 ["Limpiar barra, mesas, utensilios y refrigeración","Limpieza",40,"BOOLEAN",
  "Verificar área de preparación sin residuos."],
 ["Lavar y separar trapos para siguiente turno","Limpieza",50,"BOOLEAN",
  "Separar trapos para área de alimentos y superficies."],
 ["Verificar inventario crítico y registrar faltantes","Inventario",60,"BOOLEAN",
  "Registrar leche, café, vasos, tapas, hielo y faltantes en OPS."],
 ["Registrar incidencias y pendientes para mañana","Turno",70,"TEXT",
  "Dejar nota explícita cuando corresponda; usar NO HAY si no existen pendientes."],
 ["Apagar equipos conforme al SOP y revisar seguridad","Seguridad",80,"BOOLEAN",
  "Validar seguridad eléctrica, puertas, canceles, iluminación y equipo."],
];
export async function seedQaOperations(db){
 const [org]=await db`select id from public.organizations where slug='cafe-epico-qa'`;
 const [store]=await db`select id,organization_id as "organizationId" from public.stores where code='QA-TEPEXI'`;
 if(!org||!store||store.organizationId!==org.id)throw Error("Ámbito QA desconocido.");
 const [counts]=await db`select
   (select count(*)::int from public.organizations) as organizations,
   (select count(*)::int from public.stores) as stores`;
 if(counts.organizations!==1||counts.stores!==1)
   throw Error("No modificar datos en una base con organizaciones adicionales.");
 return db.begin(async tx=>{
   const [barista]=await tx`select id from public.roles
     where organization_id=${org.id} and code='BARISTA'`;
   if(!barista)throw Error("No existe rol BARISTA QA");
   const opening=await tx`update public.checklist_tasks t
     set title='Verificar fondo de caja OPS y registrar apertura'
     from public.checklist_templates p
     where t.checklist_template_id=p.id and p.organization_id=${org.id}
       and p.shift_type='MORNING' and
       t.title='Abrir turno/caja en Loyverse y registrar fondo real'
     returning t.id`;
   const [existing]=await tx`select id from public.checklist_templates
     where organization_id=${org.id} and store_id=${store.id} and shift_type='CLOSING'
     order by created_at limit 1`;
   let templateId=existing?.id;
   if(!templateId){
     const [created]=await tx`insert into public.checklist_templates
       (organization_id,store_id,name,shift_type)
       values(${org.id},${store.id},'Cierre de barra y cafetería','CLOSING')
       returning id`;
     templateId=created.id;
   }
   let inserted=0;
   for(const [title,area,sortOrder,inputType,description] of closingTasks){
     const [found]=await tx`select id from public.checklist_tasks
       where organization_id=${org.id} and checklist_template_id=${templateId}
         and title=${title} limit 1`;
     if(found)continue;
     await tx`insert into public.checklist_tasks
       (organization_id,checklist_template_id,title,description,area,
        priority,is_required,sort_order,input_type,assigned_role_id)
       values(${org.id},${templateId},${title},${description},${area},
        'NORMAL',true,${sortOrder},${inputType}::checklist_input_type,${barista.id})`;
     inserted++;
   }
   return {updatedOpening:opening.length,insertedClosing:inserted,totalClosing:closingTasks.length};
 });
}

async function main(){
 const g=validateLocalQaConfig(process.env);
 if(!g.ok)throw Error("Entorno QA no autorizado.");
 const db=postgres(process.env.DATABASE_URL,{prepare:false,max:1,connect_timeout:5});
 try{
   const result=await seedQaOperations(db);
   console.log("PASS: apertura OPS actualizada="+result.updatedOpening+
     ", cierre QA tareas nuevas="+result.insertedClosing+
     ", total esperadas="+result.totalClosing);
 }finally{await db.end({timeout:3});}
}
if(process.argv[1]?.endsWith("seed-qa-operations.mjs")){
 main().catch(()=>{console.error("BLOQUEADO: plantilla operativa QA no aplicada.");process.exitCode=1});
}
