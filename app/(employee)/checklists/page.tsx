import Link from "next/link";
import {
  completeChecklistTask,
  startChecklistTask,
} from "@/app/actions/checklists";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  elapsedSeconds,
  formatDurationSeconds,
  timingMetrics,
} from "@/src/domain/checklists/timing";

export const dynamic = "force-dynamic";

function validationLabel(status: string | null) {
  if (!status || status === "OK") return "Completada";
  if (status.startsWith("BELOW_MIN:")) {
    return `Completada · Debajo del mínimo (${status.split(":")[1]})`;
  }
  if (status.startsWith("ABOVE_MAX:")) {
    return `Completada · Arriba del máximo (${status.split(":")[1]})`;
  }
  return `Completada · ${status}`;
}

function formatTime(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleTimeString("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: Date | null, completedAt: Date | null) {
  const seconds = elapsedSeconds(startedAt, completedAt);
  return seconds == null ? "duración no medida" : formatDurationSeconds(seconds);
}

function timingLabel(
  targetSeconds: number | null,
  startedAt: Date | null,
  completedAt: Date | null,
) {
  if (!targetSeconds) return null;

  const metrics = timingMetrics(targetSeconds, startedAt, completedAt);
  if (metrics.actualSeconds == null) {
    return `Objetivo ${formatDurationSeconds(targetSeconds)}`;
  }

  const sign =
    metrics.variancePercent != null && metrics.variancePercent > 0 ? "+" : "";
  return `Objetivo ${formatDurationSeconds(targetSeconds)} · real ${formatDurationSeconds(
    metrics.actualSeconds,
  )} · ${sign}${metrics.variancePercent?.toFixed(0) ?? "0"}%`;
}

export default async function ChecklistsPage() {
  const { employee } = await getCurrentEmployee();
  const { run, tasks } = await getOrCreateChecklistRun(
    process.env.DEFAULT_STORE_CODE ?? "TEPEXI",
    "MORNING",
    employee.id,
  );

  const completed = tasks.filter((task) => task.status === "COMPLETED").length;
  const done = tasks.length > 0 && completed === tasks.length;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CHECKLIST DINÁMICA · {run.businessDate}</p>
        <h1>Apertura</h1>
        <p className="muted">
          {completed} / {tasks.length} tareas completadas.
        </p>
        {done && <p className="status-ok">Apertura completada.</p>}
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

              {task.targetDurationSecondsSnapshot && (
                <div className="muted">
                  Objetivo:{" "}
                  {formatDurationSeconds(task.targetDurationSecondsSnapshot)}
                </div>
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

              {task.status === "COMPLETED" ? (
                <div style={{ marginTop: ".5rem" }}>
                  <div
                    className={
                      task.validationStatus === "OK" ||
                      !task.validationStatus
                        ? "status-ok"
                        : "status-warn"
                    }
                  >
                    {validationLabel(task.validationStatus)}
                  </div>
                  <div className="muted">
                    Terminó {formatTime(task.completedAt)} ·{" "}
                    {timingLabel(
                      task.targetDurationSecondsSnapshot,
                      task.startedAt,
                      task.completedAt,
                    ) ?? formatDuration(task.startedAt, task.completedAt)}
                  </div>
                  {task.comment && (
                    <div className="muted">Nota: {task.comment}</div>
                  )}
                </div>
              ) : !task.startedAt ? (
                <form
                  action={startChecklistTask}
                  style={{ marginTop: ".7rem" }}
                >
                  <input type="hidden" name="taskId" value={task.id} />
                  <button type="submit">Iniciar tarea</button>
                </form>
              ) : (
                <div style={{ marginTop: ".7rem" }}>
                  <div className="status-warn">
                    En proceso · inició {formatTime(task.startedAt)}
                  </div>

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

                    <input
                      name="comment"
                      placeholder="Comentario opcional"
                    />

                    <button type="submit">Completar tarea</button>
                  </form>
                </div>
              )}
            </div>
          </div>
        ))}
      </article>
    </main>
  );
}
