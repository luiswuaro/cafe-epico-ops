import Link from "next/link";
import {
  getShiftReportEmployees,
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

  const employeeId =
    typeof params.employee === "string" && params.employee
      ? params.employee
      : null;

  const [reports, employees] = await Promise.all([
    getShiftReports(organizationId, filter, 30, employeeId),
    getShiftReportEmployees(organizationId),
  ]);

  const completedRuns = reports.filter(
    (report) => report.status === "COMPLETED",
  );
  const measuredTasks = reports.reduce(
    (sum, report) => sum + report.measuredTasks,
    0,
  );
  const onTargetTasks = reports.reduce(
    (sum, report) => sum + report.onTargetTasks,
    0,
  );
  const latestHandoff = reports.find(
    (report) => report.shiftType === "HANDOFF",
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · REPORTES</p>
        <h1>Turnos y tareas</h1>
        <p className="muted">
          Historial de apertura y entrega con notas, valores, hora de inicio y
          fin, y tiempo transcurrido entre “Iniciar” y “Completar”. No funciona
          como reloj checador de jornada laboral.
        </p>
      </section>

      <section className="card report-filters">
        <form method="get">
          <label>
            Tipo
            <select name="shift" defaultValue={filter}>
              <option value="ALL">Todos</option>
              <option value="MORNING">Aperturas</option>
              <option value="HANDOFF">Entregas de turno</option>
            </select>
          </label>
          <label>
            Colaborador
            <select name="employee" defaultValue={employeeId ?? ""}>
              <option value="">Todos</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Aplicar filtros</button>
        </form>
      </section>

      <section className="grid report-kpis" style={{ marginTop: "1rem" }}>
        <article className="card">
          <span className="pill">TURNOS</span>
          <div className="metric">{reports.length}</div>
          <p>en la muestra filtrada.</p>
        </article>
        <article className="card">
          <span className="pill">CERRADOS</span>
          <div className="metric">{completedRuns.length}</div>
          <p>
            {reports.length > 0
              ? Math.round((completedRuns.length / reports.length) * 100) +
                "% de la muestra."
              : "Sin muestra."}
          </p>
        </article>
        <article className="card">
          <span className="pill">TAREAS MEDIDAS</span>
          <div className="metric">{measuredTasks}</div>
          <p>con objetivo y tiempo real.</p>
        </article>
        <article className="card">
          <span className="pill">DENTRO DE OBJETIVO</span>
          <div className="metric">
            {measuredTasks > 0
              ? Math.round((onTargetTasks / measuredTasks) * 100) + "%"
              : "—"}
          </div>
          <p>
            {measuredTasks > 0
              ? onTargetTasks + " / " + measuredTasks + " tareas."
              : "Sin tareas medidas."}
          </p>
        </article>
      </section>

      {latestHandoff && (
        <section className="card latest-handoff" style={{ marginTop: "1rem" }}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">ÚLTIMA ENTREGA VISIBLE</p>
              <h2>
                {latestHandoff.businessDate} ·{" "}
                {latestHandoff.completedByName ??
                  latestHandoff.startedByName ??
                  "Sin responsable identificado"}
              </h2>
            </div>
            <span
              className={
                latestHandoff.status === "COMPLETED"
                  ? "status-ok"
                  : "status-warn"
              }
            >
              {latestHandoff.status === "COMPLETED" ? "CERRADA" : "ABIERTA"}
            </span>
          </div>
          <p className="muted">
            Cierre {formatTime(latestHandoff.completedAt)} ·{" "}
            {latestHandoff.completedTasks}/{latestHandoff.taskCount} tareas ·{" "}
            {latestHandoff.onTargetRate == null
              ? "eficiencia sin muestra"
              : Math.round(latestHandoff.onTargetRate) +
                "% dentro de objetivo"}
          </p>
          {latestHandoff.closingNote ? (
            <div className="handoff-note-preview">
              <strong>Nota general:</strong> {latestHandoff.closingNote}
            </div>
          ) : (
            <p className="muted">Sin nota general de entrega.</p>
          )}
        </section>
      )}

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
                    Checklist inició {formatTime(report.startedAt)}
                    {" · "}
                    cerró {formatTime(report.completedAt)}
                  </div>
                  <div className="muted">
                    Duración del checklist: {formatDuration(report.durationSeconds)}
                  </div>
                  <div className="muted">
                    Avance {report.completedTasks}/{report.taskCount} ·{" "}
                    {Math.round(report.completionRate)}%
                    {report.onTargetRate == null
                      ? ""
                      : " · " +
                        Math.round(report.onTargetRate) +
                        "% dentro de objetivo"}
                  </div>
                  {(report.startedByName || report.completedByName) && (
                    <div className="muted">
                      Inició {report.startedByName ?? "—"} · cerró{" "}
                      {report.completedByName ?? "—"}
                    </div>
                  )}
                </div>
              </div>

              {report.closingNote && (
                <div className="handoff-note-preview">
                  <strong>Nota general del turno:</strong>{" "}
                  {report.closingNote}
                </div>
              )}

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
