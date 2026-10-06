import Link from "next/link";
import {
  getShiftReports,
  type ShiftReportFilter,
} from "@/src/application/reports/shifts";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { timingMetrics } from "@/src/domain/checklists/timing";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatTime(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "duración no medida";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder > 0
      ? `${minutes} min ${remainder} s`
      : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} h ${mins} min`;
}

function taskValue(task: {
  numericValue: string | null;
  textValue: string | null;
  booleanValue: boolean | null;
}) {
  if (task.textValue) return task.textValue;
  if (task.numericValue != null) return task.numericValue;
  if (task.booleanValue === true) return "Sí";
  if (task.booleanValue === false) return "No";
  return null;
}

export default async function ShiftReportsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("checklist.manage");

  const requested =
    typeof params.shift === "string" ? params.shift : "ALL";
  const filter: ShiftReportFilter =
    requested === "MORNING" || requested === "HANDOFF"
      ? requested
      : "ALL";

  const reports = await getShiftReports(organizationId, filter, 30);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · REPORTES</p>
        <h1>Turnos y tareas</h1>
        <p className="muted">
          Historial de apertura y entrega con notas, valores, hora de
          finalización y duración real cuando la tarea fue iniciada con timer.
        </p>
      </section>

      <section className="card">
        <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
          <Link href="/admin/reports/shifts?shift=ALL">Todos</Link>
          <Link href="/admin/reports/shifts?shift=MORNING">Aperturas</Link>
          <Link href="/admin/reports/shifts?shift=HANDOFF">
            Entregas de turno
          </Link>
        </div>
      </section>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {reports.length === 0 ? (
          <p className="card muted">No hay turnos para este filtro.</p>
        ) : (
          reports.map((report) => (
            <article className="card" key={report.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span className="pill">
                    {report.shiftType === "MORNING"
                      ? "APERTURA"
                      : report.shiftType === "HANDOFF"
                        ? "ENTREGA"
                        : report.shiftType}
                  </span>
                  <h2 style={{ marginTop: ".5rem" }}>
                    {report.businessDate} · {report.templateName}
                  </h2>
                </div>
                <div>
                  <strong>{report.status}</strong>
                  <div className="muted">
                    Inicio {formatTime(report.startedAt)}
                    {" · "}
                    cierre {formatTime(report.completedAt)}
                  </div>
                  <div className="muted">
                    Duración del turno: {formatDuration(report.durationSeconds)}
                  </div>
                  {report.startedByName && (
                    <div className="muted">
                      Iniciado por {report.startedByName}
                    </div>
                  )}
                </div>
              </div>

              <div className="stack" style={{ marginTop: "1rem" }}>
                {report.tasks.map((task) => {
                  const value = taskValue(task);
                  const timing = timingMetrics(
                    task.targetDurationSeconds,
                    task.startedAt,
                    task.completedAt,
                  );
                  return (
                    <div className="task" key={task.id}>
                      <div style={{ flex: 1 }}>
                        <div>
                          <strong>{task.title}</strong>{" "}
                          <span
                            className={
                              task.status === "COMPLETED"
                                ? "status-ok"
                                : "status-warn"
                            }
                          >
                            {task.status}
                          </span>
                        </div>

                        <div className="muted">
                          Inició {formatTime(task.startedAt)}
                          {" · "}
                          terminó {formatTime(task.completedAt)}
                          {" · "}
                          {formatDuration(task.durationSeconds)}
                        </div>

                        {task.targetDurationSeconds && (
                          <div
                            className={
                              timing.onTarget === false
                                ? "status-warn"
                                : "muted"
                            }
                          >
                            Objetivo {formatDuration(task.targetDurationSeconds)}
                            {timing.variancePercent != null
                              ? ` · desviación ${timing.variancePercent > 0 ? "+" : ""}${timing.variancePercent.toFixed(0)}%`
                              : ""}
                          </div>
                        )}

                        {(task.startedByName || task.completedByName) && (
                          <div className="muted">
                            {task.startedByName
                              ? `Inició: ${task.startedByName}`
                              : ""}
                            {task.startedByName && task.completedByName
                              ? " · "
                              : ""}
                            {task.completedByName
                              ? `Terminó: ${task.completedByName}`
                              : ""}
                          </div>
                        )}

                        {value && (
                          <div>
                            Valor: <strong>{value}</strong>
                          </div>
                        )}

                        {task.comment && (
                          <div>
                            Nota: <strong>{task.comment}</strong>
                          </div>
                        )}

                        {task.validationStatus &&
                          task.validationStatus !== "OK" && (
                            <div className="status-warn">
                              {task.validationStatus}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
