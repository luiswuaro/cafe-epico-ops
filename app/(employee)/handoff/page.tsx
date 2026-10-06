import Link from "next/link";
import { completeChecklistTask } from "@/app/actions/checklists";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function HandoffPage() {
  const { employee } = await getCurrentEmployee();
  const { run, tasks } = await getOrCreateChecklistRun(
    process.env.DEFAULT_STORE_CODE ?? "TEPEXI",
    "HANDOFF",
    employee.id,
  );

  const completed = tasks.filter((task) => task.status === "COMPLETED").length;
  const done = tasks.length > 0 && completed === tasks.length;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ENTREGA DE TURNO · {run.businessDate}</p>
        <h1>Entrega de turno</h1>
        <p className="muted">
          {completed} / {tasks.length} tareas completadas.
        </p>
        {done && <p className="status-ok">Entrega completada.</p>}
      </section>

      <article className="card">
        {tasks.map((task) => (
          <div className="task" key={task.id}>
            <span
              className="check"
              style={{
                background:
                  task.status === "COMPLETED" ? "#1f6b45" : "transparent",
              }}
            />
            <div style={{ flex: 1 }}>
              <strong>{task.titleSnapshot}</strong>
              {task.descriptionSnapshot && (
                <div className="muted">{task.descriptionSnapshot}</div>
              )}
              {task.sopVersionId && (
                <div style={{ marginTop: ".4rem" }}>
                  <Link
                    href={`/sops/version/${task.sopVersionId}`}
                    className="pill"
                  >
                    ¿Cómo hacerlo?
                  </Link>
                </div>
              )}

              {task.status !== "COMPLETED" ? (
                <form
                  action={completeChecklistTask}
                  className="stack"
                  style={{ marginTop: ".7rem" }}
                >
                  <input type="hidden" name="taskId" value={task.id} />
                  {task.inputTypeSnapshot !== "BOOLEAN" && (
                    <input
                      name="value"
                      required={task.requiredSnapshot}
                      inputMode={
                        ["NUMBER", "TEMPERATURE", "WEIGHT", "TIME"].includes(
                          task.inputTypeSnapshot,
                        )
                          ? "decimal"
                          : undefined
                      }
                      placeholder={
                        task.inputTypeSnapshot === "NUMBER"
                          ? "Monto / valor"
                          : "Escribe la información"
                      }
                    />
                  )}
                  <input name="comment" placeholder="Comentario opcional" />
                  <button type="submit">Completar</button>
                </form>
              ) : (
                <div className="status-ok">Completada</div>
              )}
            </div>
          </div>
        ))}
      </article>
    </main>
  );
}
