import Link from "next/link";
import { completeChecklistTask } from "@/app/actions/checklists";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function ChecklistsPage() {
  const { employee } = await getCurrentEmployee();
  const { run, tasks } = await getOrCreateChecklistRun(process.env.DEFAULT_STORE_CODE ?? "TEPEXI", "MORNING", employee.id);
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  return <main className="shell"><section className="hero"><p className="eyebrow">CHECKLIST DINÁMICA · {run.businessDate}</p><h1>Apertura</h1><p className="muted">{completed} / {tasks.length} tareas completadas. Las frecuencias se resuelven desde la configuración, no desde código de la pantalla.</p></section>
    <article className="card">{tasks.map((task) => <div className="task" key={task.id}>
      <span className="check" style={{background:task.status==="COMPLETED"?"#1f6b45":"transparent"}}/>
      <div style={{flex:1}}><strong>{task.titleSnapshot}</strong>{task.descriptionSnapshot && <div className="muted">{task.descriptionSnapshot}</div>}{task.sopVersionId && <div style={{marginTop:".4rem"}}><Link href={`/sops/version/${task.sopVersionId}`} className="pill">¿Cómo hacerlo?</Link></div>}
      {task.status !== "COMPLETED" ? <form action={completeChecklistTask} className="stack" style={{marginTop:'.7rem'}}><input type="hidden" name="taskId" value={task.id}/>
        {task.inputTypeSnapshot !== "BOOLEAN" && <input name="value" required={task.requiredSnapshot} inputMode={["NUMBER","TEMPERATURE","WEIGHT","TIME"].includes(task.inputTypeSnapshot)?"decimal":undefined} placeholder="Valor"/>}
        <input name="comment" placeholder="Comentario opcional"/><button type="submit">Completar</button></form> : <div className="status-ok">Completada</div>}
      </div></div>)}</article></main>;
}
