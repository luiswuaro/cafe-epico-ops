import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { resolveOperationalEvent } from "./actions";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  employees,
  operationalEvents,
} from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = {
  WASTE: "MERMA",
  REMAKE: "REHECHA",
  EQUIPMENT: "EQUIPO",
  STOCK: "STOCK",
  SERVICE: "SERVICIO",
  OTHER: "OTRO",
};

export default async function OperationalEventsAdminPage() {
  const { organizationId } = await requirePermission("admin.access");

  const rows = await getDb()
    .select({
      id: operationalEvents.id,
      eventType: operationalEvents.eventType,
      severity: operationalEvents.severity,
      itemNameSnapshot: operationalEvents.itemNameSnapshot,
      quantity: operationalEvents.quantity,
      unitLabel: operationalEvents.unitLabel,
      note: operationalEvents.note,
      occurredAt: operationalEvents.occurredAt,
      resolvedAt: operationalEvents.resolvedAt,
      employeeName: employees.name,
    })
    .from(operationalEvents)
    .leftJoin(employees, eq(employees.id, operationalEvents.employeeId))
    .where(eq(operationalEvents.organizationId, organizationId))
    .orderBy(desc(operationalEvents.occurredAt))
    .limit(100);

  const open = rows.filter(
    (row) =>
      !row.resolvedAt &&
      ["EQUIPMENT", "STOCK", "SERVICE", "OTHER"].includes(row.eventType),
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · OPERACIÓN</p>
        <h1>Mermas e incidencias</h1>
        <p className="muted">
          Registro rápido de barra para explicar desviaciones de inventario,
          retrabajo y fallas que requieren seguimiento.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">ABIERTAS</span>
          <div className="metric">{open.length}</div>
          <p>incidencias con seguimiento pendiente.</p>
        </article>
        <article className="card">
          <span className="pill">EVENTOS</span>
          <div className="metric">{rows.length}</div>
          <p>últimos registros mostrados.</p>
        </article>
        <article className="card">
          <span className="pill">MERMA</span>
          <div className="metric">
            {rows.filter((row) => row.eventType === "WASTE").length}
          </div>
          <p>eventos de merma registrados.</p>
        </article>
      </section>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {rows.length === 0 ? (
          <p className="card muted">Todavía no hay eventos.</p>
        ) : (
          rows.map((row) => (
            <article className="card" key={row.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div>
                    <span className="pill">
                      {typeLabels[row.eventType] ?? row.eventType}
                    </span>{" "}
                    <strong>{row.severity}</strong>
                  </div>
                  {row.itemNameSnapshot && (
                    <h2 style={{ marginTop: ".6rem" }}>
                      {row.itemNameSnapshot}
                    </h2>
                  )}
                  {row.quantity != null && (
                    <p>
                      Cantidad:{" "}
                      <strong>
                        {Number(row.quantity).toFixed(3)}{" "}
                        {row.unitLabel ?? ""}
                      </strong>
                    </p>
                  )}
                  {row.note && (
                    <p style={{ whiteSpace: "pre-wrap" }}>{row.note}</p>
                  )}
                  <p className="muted">
                    {row.employeeName ?? "Sin empleado"} ·{" "}
                    {row.occurredAt.toLocaleString("es-MX", {
                      timeZone: "America/Mexico_City",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </div>

                <div>
                  {row.resolvedAt ? (
                    <span className="status-ok">RESUELTA</span>
                  ) : ["EQUIPMENT", "STOCK", "SERVICE", "OTHER"].includes(
                      row.eventType,
                    ) ? (
                    <form action={resolveOperationalEvent}>
                      <input type="hidden" name="eventId" value={row.id} />
                      <button type="submit">Marcar resuelta</button>
                    </form>
                  ) : (
                    <span className="muted">Registro informativo</span>
                  )}
                </div>
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
