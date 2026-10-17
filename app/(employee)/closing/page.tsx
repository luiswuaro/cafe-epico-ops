import Link from "next/link";
import {notFound} from "next/navigation";
import {completeChecklistTask,saveChecklistRunNote,startChecklistTask} from "@/app/actions/checklists";
import {getOrCreateChecklistRun} from "@/src/application/checklists/run";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {requirePermission} from "@/src/infrastructure/auth/permissions";

export const dynamic="force-dynamic";
const formatTime=(date:Date|null)=>date?.toLocaleTimeString("es-MX",{
  timeZone:"America/Mexico_City",hour:"2-digit",minute:"2-digit"
})??"—";

export default async function ClosingQaPage(){
 // Cierre añadido para el piloto: en producción se activará únicamente
 // cuando una plantilla CLOSING real esté revisada y publicada.
 if(process.env.OPS_LOCAL_FIRST!=="true"||process.env.OPS_QA_MODE!=="true"||
    process.env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa")notFound();
 await requirePermission("checklist.execute");
 const {employee}=await getCurrentEmployee();
 const {run,tasks}=await getOrCreateChecklistRun(
   process.env.DEFAULT_STORE_CODE??"QA-TEPEXI","CLOSING",employee.id);
 const completed=tasks.filter(t=>t.status==="COMPLETED").length;
 return <main className="shell qa-closing">
   <section className="hero">
     <p className="eyebrow">OPERACIÓN LOCAL QA · {run.businessDate}</p>
     <h1>Cierre de cafetería</h1>
     <p className="muted">Registra cada tarea con tu sesión, hora y comentarios.
       Esto NO cierra caja ni apaga equipos automáticamente.</p>
     <p className={completed===tasks.length&&tasks.length>0?"status-ok":"status-warn"}>
       {completed} de {tasks.length} tareas realizadas
     </p>
     <div className="qa-closing-nav">
       <Link className="button" href="/checklists">Apertura</Link>
       <Link className="button" href="/handoff">Entrega de turno</Link>
       <Link className="button" href="/today">Hoy</Link>
     </div>
   </section>
   <section className="card" aria-label="Checklist de cierre">
     {tasks.map(task=><article className="task" key={task.id}>
       <div className="qa-closing-task">
         <strong>{task.titleSnapshot}</strong>
         {task.descriptionSnapshot&&<p className="muted">{task.descriptionSnapshot}</p>}
         {task.status==="COMPLETED"?<>
           <p className="status-ok">Realizada · {formatTime(task.completedAt)}</p>
           {task.comment&&<p className="muted">Nota: {task.comment}</p>}
           {task.textValue&&<p className="muted">Registro: {task.textValue}</p>}
         </>:!task.startedAt?
           <form action={startChecklistTask}>
             <input type="hidden" name="taskId" value={task.id}/>
             <button type="submit">Iniciar</button>
           </form>
         :<form action={completeChecklistTask} className="stack">
           <input type="hidden" name="taskId" value={task.id}/>
           <p className="muted">Iniciada: {formatTime(task.startedAt)}</p>
           {task.inputTypeSnapshot!=="BOOLEAN"&&
             <label>Registro de cierre
               <input name="value" required={task.requiredSnapshot}
                 placeholder="Escribe el pendiente o NO HAY"/>
             </label>}
           <label>Observaciones
             <input name="comment" maxLength={400}
               placeholder="Opcional · incidencia o evidencia escrita"/>
           </label>
           <button type="submit">Marcar completada</button>
         </form>}
       </div>
     </article>)}
   </section>
   <section className="card" style={{marginTop:16}}>
     <h2>Nota de cierre</h2>
     <form action={saveChecklistRunNote} className="stack">
       <input type="hidden" name="runId" value={run.id}/>
       <textarea name="note" maxLength={2000} rows={3}
         defaultValue={run.closingNote??""} placeholder="Faltantes, incidencias y pendientes para mañana"/>
       <button type="submit">Guardar nota de cierre</button>
     </form>
   </section>
   <style>{`
      .qa-closing-nav{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
      .qa-closing-task{flex:1;min-width:0}
      .qa-closing-task strong{color:#191816;font-size:1rem}
      .qa-closing-task label{color:#28231e;font-weight:700}
      .qa-closing-task input{color:#191816;background:#fff}
      .qa-closing-task button{color:#fff;background:#191816;min-height:44px}
      .qa-closing .muted{color:#514a43}
    `}</style>
 </main>;
}
