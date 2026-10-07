import Link from "next/link";
import {
  completeChecklistTask,
  startChecklistTask,
} from "@/app/actions/checklists";
import { getBaristaCockpit } from "@/src/application/barista/cockpit";
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

export default async function HandoffPage() {
  const { employee } = await getCurrentEmployee();
  const [{ run, tasks }, cockpit] = await Promise.all([
    getOrCreateChecklistRun(
      process.env.DEFAULT_STORE_CODE ?? "TEPEXI",
      "HANDOFF",
      employee.id,
    ),
    getBaristaCockpit(employee),
  ]);

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

      <section className="grid" style={{ marginBottom: "1rem" }}>
        <article className="card">
          <p className="eyebrow">CAFÉ QUE RECIBE EL SIGUIENTE TURNO</p>
          {cockpit.activeRoast ? (
            <>
              <h2>{cockpit.activeRoast.lotName}</h2>
              <p>
                Batch <strong>{cockpit.activeRoast.batchCode}</strong> ·{" "}
                {cockpit.activeRoast.ageDays.toFixed(1)} d post-tueste
              </p>
              <p className="muted">
                QC hoy: {cockpit.calibration.attemptsToday} intento(s) ·{" "}
                {cockpit.calibration.passedToday} aprobado(s)
                {cockpit.calibration.passRate == null
                  ? ""
                  : " · " + cockpit.calibration.passRate.toFixed(0) + "%"}
              </p>
            </>
          ) : (
            <p className="status-warn">
              No hay batch de espresso asignado.
            </p>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">RIESGOS QUE DEBEN QUEDAR DICHOS</p>
          <h2>
            {cockpit.shiftRisks.length + cockpit.incidents.length} pendiente(s)
          </h2>
          {cockpit.shiftRisks.length === 0 &&
          cockpit.incidents.length === 0 ? (
            <p className="status-ok">
              Sin riesgos de stock ni incidencias abiertas.
            </p>
          ) : (
            <div className="stack">
              {cockpit.shiftRisks.slice(0, 4).map((risk) => (
                <div className="task" key={risk.variantExternalId}>
                  <div>
                    <strong>{risk.itemName}</strong>
                    <div className="status-warn">
                      Stock {risk.inStock.toFixed(2)} {risk.unitLabel} ·
                      esperado {risk.expectedShift.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
              {cockpit.incidents.slice(0, 4).map((incident) => (
                <div className="task" key={incident.id}>
                  <div>
                    <strong>{incident.area ?? "Barra"}</strong>
                    <div>{incident.note}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid" style={{ marginBottom: "1rem" }}>
        <article className="card">
          <p className="eyebrow">CALIDAD DEL TURNO</p>
          <h2>Merma y remakes</h2>
          <p>
            Merma: <strong>{cockpit.lossSummary.wasteEvents}</strong> ·
            remakes: <strong>{cockpit.lossSummary.remakeEvents}</strong>
          </p>
          <p className="muted">
            Costo estimado registrado:{" "}
            {new Intl.NumberFormat("es-MX", {
              style: "currency",
              currency: "MXN",
              maximumFractionDigits: 0,
            }).format(cockpit.lossSummary.estimatedLossCost)}
            {cockpit.lossSummary.remakeRate == null
              ? ""
              : " · remake rate " +
                cockpit.lossSummary.remakeRate.toFixed(1) +
                "%"}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">CONTEOS FÍSICOS</p>
          <h2>
            {
              cockpit.stockCountsToday.filter(
                (row) => row.pendingAdmin,
              ).length
            }{" "}
            pendiente(s) de conciliación
          </h2>
          <p className="muted">
            {cockpit.stockCountsToday.length} insumo(s) contado(s) hoy. Las
            diferencias quedan visibles para administración y no modifican
            Loyverse desde la entrega.
          </p>
        </article>
      </section>

      {cockpit.unavailableProducts.length > 0 && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <p className="eyebrow">PRODUCTOS NO DISPONIBLES</p>
          <h2>No dejar que el siguiente turno los prometa</h2>
          <div className="stack">
            {cockpit.unavailableProducts.slice(0, 8).map((row) => (
              <div className="task" key={row.variantExternalId}>
                <strong>{row.itemName}</strong>
                <span className="status-warn">
                  Falta: {row.blockers.join(", ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

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
