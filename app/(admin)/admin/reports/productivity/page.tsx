import Link from "next/link";
import { getProductivityReport } from "@/src/application/reports/productivity";
import { formatDurationSeconds } from "@/src/domain/checklists/timing";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ProductivityReportPage() {
  const { organizationId } = await requirePermission("checklist.manage");
  const report = await getProductivityReport(organizationId, 30);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · PRODUCTIVIDAD</p>
        <h1>Eficiencia de tareas · 30 días</h1>
        <p className="muted">
          Solo entran tareas que tengan tiempo objetivo y que hayan sido
          iniciadas y terminadas con el cronómetro del sistema.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">MUESTRA</span>
          <div className="metric">{report.measuredTasks}</div>
          <p>tareas con objetivo medible.</p>
        </article>

        {report.employeeSummaries.map((employee) => (
          <article className="card" key={employee.employeeId ?? "none"}>
            <span className="pill">{employee.employeeName}</span>
            <div className="metric">
              {employee.onTargetRate.toFixed(0)}%
            </div>
            <p>
              {employee.onTargetTasks} / {employee.measuredTasks} dentro del
              objetivo.
            </p>
            <p className="muted">
              Real promedio {formatDurationSeconds(employee.avgActualSeconds)}
              {" · "}
              objetivo promedio{" "}
              {formatDurationSeconds(employee.avgTargetSeconds)}
              {" · "}
              desviación promedio{" "}
              {employee.avgVariancePercent > 0 ? "+" : ""}
              {employee.avgVariancePercent.toFixed(0)}%
            </p>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Mayores desviaciones</h2>
        {report.recentExceptions.length === 0 ? (
          <p className="muted">
            Todavía no hay tareas por encima de su objetivo en la muestra.
          </p>
        ) : (
          <div className="stack">
            {report.recentExceptions.map((task) => (
              <div className="task" key={task.id}>
                <div style={{ flex: 1 }}>
                  <strong>{task.title}</strong>
                  <div className="muted">
                    {task.employeeName ?? "Sin empleado"} · {task.businessDate}
                    {" · "}
                    {task.shiftType}
                  </div>
                  <div className="status-warn">
                    Objetivo {formatDurationSeconds(task.targetSeconds)}
                    {" · "}
                    real {formatDurationSeconds(task.actualSeconds)}
                    {" · +"}
                    {task.variancePercent.toFixed(0)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/reports/shifts">Ver detalle de turnos →</Link>
      </p>
      <p>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
