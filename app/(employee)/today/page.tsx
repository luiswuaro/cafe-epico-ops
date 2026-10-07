import Link from "next/link";
import { markEmployeeMessageRead } from "@/app/actions/messages";
import { getTodayOperationalSummary } from "@/src/application/dashboard/today";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { employee } = await getCurrentEmployee();
  const summary = await getTodayOperationalSummary(employee);

  const openingDone =
    summary.opening.total > 0 &&
    summary.opening.completed === summary.opening.total;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OPERACIÓN · TEPEXI · {summary.businessDate}</p>
        <h1>Hoy en Café Épico</h1>
        <p className="muted">
          Apertura, espresso, inventario y entrega conectados a datos reales.
        </p>
      </section>

      {summary.messages.length > 0 && (
        <section className="stack" style={{ marginBottom: "1rem" }}>
          {summary.messages.map((message) => (
            <article
              className={
                message.priority === "IMPORTANT"
                  ? "alert"
                  : "card"
              }
              key={message.id}
            >
              <p className="eyebrow">
                {message.priority === "IMPORTANT"
                  ? "NOTA IMPORTANTE"
                  : "NOTA DE OPERACIÓN"}
              </p>
              <h2>{message.title}</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
              <p className="muted">
                Enviada{" "}
                {message.createdAt.toLocaleString("es-MX", {
                  timeZone: "America/Mexico_City",
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
              <form action={markEmployeeMessageRead}>
                <input
                  type="hidden"
                  name="messageId"
                  value={message.id}
                />
                <button type="submit">Marcar como leída</button>
              </form>
            </article>
          ))}
        </section>
      )}

      <section className="grid" style={{ marginBottom: "1rem" }}>
        <article className="card">
          <p className="eyebrow">BARRA · TURNO ACTUAL</p>
          <h2>
            {summary.bar.shift === "MORNING" ? "Mañana" : "Tarde"}
          </h2>
          <p className="muted">
            Pronóstico basado en {summary.bar.forecastSampleDays} día(s)
            comparables cuando hay historial suficiente.
          </p>
          {summary.bar.traffic.nextPeak && (
            <p>
              Próxima hora fuerte estimada:{" "}
              <strong>
                {String(summary.bar.traffic.nextPeak.hour).padStart(2, "0")}:00
              </strong>{" "}
              · {summary.bar.traffic.nextPeak.tickets.toFixed(1)} tickets/h
              históricos.
            </p>
          )}
          {summary.bar.activeRoast ? (
            <>
              <strong>{summary.bar.activeRoast.lotName}</strong>
              <div className="muted">
                Batch {summary.bar.activeRoast.batchCode} ·{" "}
                {summary.bar.activeRoast.ageDays.toFixed(1)} d post-tueste
              </div>
            </>
          ) : (
            <p className="status-warn">
              No hay batch activo asignado a espresso.
            </p>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">QC ESPRESSO · HOY</p>
          <div className="metric">{summary.espressoToday.checks}</div>
          <p>controles registrados</p>
          {summary.espressoToday.passRate != null && (
            <p className="muted">
              Aprobación {summary.espressoToday.passRate.toFixed(0)}% · tiempo
              medio {summary.espressoToday.averageTimeS?.toFixed(1)} s
            </p>
          )}
          {summary.espressoToday.consecutiveOutOfSpec >= 2 ? (
            <p className="status-warn">
              {summary.espressoToday.consecutiveOutOfSpec} controles
              consecutivos fuera de especificación. Revisar calibración antes
              de seguir tomando el control como estable.
            </p>
          ) : (
            <p className="muted">
              {summary.espressoToday.consecutiveOutOfSpec === 1
                ? "Último control fuera de especificación."
                : "Sin racha de controles fuera de especificación."}
            </p>
          )}
          <Link href="/quality/espresso">Abrir QC →</Link>
        </article>

        <article className="card">
          <p className="eyebrow">DEMANDA PROBABLE · TURNO</p>
          <h2>Qué se mueve más</h2>
          {summary.bar.topProducts.length === 0 ? (
            <p className="muted">
              Aún no hay muestra histórica suficiente para este día.
            </p>
          ) : (
            <div className="stack">
              {summary.bar.topProducts.slice(0, 5).map((row) => (
                <div className="task" key={row.name}>
                  <strong>{row.name}</strong>
                  <span>{row.expected.toFixed(1)} u. esperadas</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">RIESGO DE STOCK · TURNO</p>
          <div className="metric">{summary.bar.stockRisks.length}</div>
          <p>insumos con cobertura ajustada para el turno.</p>
          {summary.bar.stockRisks.slice(0, 3).map((row) => (
            <div className="muted" key={row.variantExternalId}>
              {row.itemName}: {row.inStock.toFixed(2)} actuales /{" "}
              {row.expectedShift.toFixed(2)} esperados
            </div>
          ))}
          <Link href="/inventory">Revisar inventario →</Link>
        </article>

        <article className="card">
          <p className="eyebrow">POSIBLES 86</p>
          <div className="metric">
            {summary.bar.unavailableProducts.length}
          </div>
          <p>productos bloqueados por algún insumo sin existencia.</p>
          {summary.bar.unavailableProducts.slice(0, 4).map((row) => (
            <div key={row.variantExternalId}>
              <strong>{row.itemName}</strong>
              <div className="muted">
                Falta: {row.blockers.join(", ")}
              </div>
            </div>
          ))}
        </article>
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <p className="eyebrow">ACCESOS RÁPIDOS DE BARRA</p>
        <div
          style={{
            display: "flex",
            gap: ".6rem",
            flexWrap: "wrap",
          }}
        >
          <Link className="button" href="/recipes">
            Recetario
          </Link>
          <Link className="button" href="/quality/espresso">
            Calibrar espresso
          </Link>
          <Link className="button" href="/sops">
            SOPs
          </Link>
          <Link className="button" href="/handoff">
            Entrega de turno
          </Link>
          <Link className="button" href="/operations/report">
            Merma / incidencia
          </Link>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">APERTURA</span>
          <div className="metric">
            {summary.opening.completed} / {summary.opening.total}
          </div>
          <p>
            {openingDone
              ? "Apertura completada."
              : "Completa primero las tareas críticas para estar operativos a las 7:30."}
          </p>
          {!openingDone && summary.opening.next && (
            <p className="muted">
              Siguiente: <strong>{summary.opening.next.title}</strong>
              {summary.opening.next.started ? " · en proceso" : ""}
            </p>
          )}
          <Link href="/checklists" className="button">
            {openingDone ? "Ver apertura" : "Continuar apertura"}
          </Link>
        </article>

        <article className="card">
          <span className="pill">ESPRESSO QC</span>
          <div className="metric">
            {summary.espresso ? `${summary.espresso.brewTimeS} s` : "22–35 s"}
          </div>
          {summary.espresso ? (
            <>
              <p>Último control de espresso registrado hoy.</p>
              <p className={summary.espresso.withinTimeSpec ? "status-ok" : "status-warn"}>
                {summary.espresso.withinTimeSpec
                  ? "Tiempo dentro de especificación"
                  : "Tiempo fuera de especificación"}
              </p>
            </>
          ) : (
            <>
              <p>Registra dosis, yield, tiempo y evaluación sensorial.</p>
              <p className="status-warn">Pendiente de control de apertura</p>
            </>
          )}
          <Link href="/quality/espresso">Abrir Espresso QC →</Link>
        </article>

        <article className="card">
          <span className="pill">INVENTARIO</span>
          <div className="metric">{summary.inventory.openShortages}</div>
          <p>
            {summary.inventory.openShortages === 0
              ? "Sin faltantes abiertos."
              : summary.inventory.openShortages === 1
                ? "1 faltante abierto requiere seguimiento."
                : `${summary.inventory.openShortages} faltantes abiertos requieren seguimiento.`}
          </p>
          <Link href="/inventory">Abrir inventario →</Link>
        </article>

        <article className="card">
          <span className="pill">ENTREGA</span>
          <div className="metric">
            {summary.handoff.completed} / {summary.handoff.total}
          </div>
          <p>
            {summary.handoff.total > 0 &&
            summary.handoff.completed === summary.handoff.total
              ? "Entrega de turno completada."
              : "Barra abastecida, limpieza, incidencias, faltantes y corte de caja."}
          </p>
          {summary.handoff.next && (
            <p className="muted">
              Siguiente: <strong>{summary.handoff.next.title}</strong>
              {summary.handoff.next.started ? " · en proceso" : ""}
            </p>
          )}
          <Link href="/handoff">
            {summary.handoff.total > 0 &&
            summary.handoff.completed === summary.handoff.total
              ? "Ver entrega →"
              : "Continuar entrega →"}
          </Link>
        </article>
      </section>
    </main>
  );
}
