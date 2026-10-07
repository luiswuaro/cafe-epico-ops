import Link from "next/link";
import { markEmployeeMessageRead } from "@/app/actions/messages";
import {
  reportBarIncident,
  reportBarWaste,
} from "./actions";
import { buildBaristaActionQueue } from "@/src/application/barista/action-queue";
import { getBaristaCockpit } from "@/src/application/barista/cockpit";
import { getTodayOperationalSummary } from "@/src/application/dashboard/today";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 2,
});

function time(date: Date) {
  return date.toLocaleTimeString("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function expectedRange(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const low = Math.max(1, Math.floor(value));
  const high = Math.max(low, Math.ceil(value));
  return low === high ? String(low) : low + "–" + high;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();
  const [summary, cockpit] = await Promise.all([
    getTodayOperationalSummary(employee),
    getBaristaCockpit(employee),
  ]);

  const openingDone =
    summary.opening.total > 0 &&
    summary.opening.completed === summary.opening.total;
  const qcOk =
    cockpit.latestQc?.withinTimeSpec === true &&
    cockpit.latestQc?.withinYieldSpec !== false;
  const shiftLabel =
    cockpit.currentShift === "MORNING" ? "MAÑANA" : "TARDE";
  const handoffWindow =
    cockpit.currentShift === "MORNING"
      ? cockpit.currentHour >= 15
      : cockpit.currentHour >= 21;
  const actionQueue = buildBaristaActionQueue({
    currentHour: cockpit.currentHour,
    handoffWindow,
    opening: summary.opening,
    handoff: summary.handoff,
    latestQc: cockpit.latestQc,
    shiftRisks: cockpit.shiftRisks,
    nextPeak: cockpit.traffic.nextPeak,
    activeRoast: cockpit.activeRoast,
    incidents: cockpit.incidents,
    inventoryCorrectionCount: cockpit.inventoryCorrectionCount,
  });

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">
          BARRA · {shiftLabel} · {summary.businessDate}
        </p>
        <h1>Hoy en Café Épico</h1>
        <p className="muted">
          Primero lo que cambia tu turno: apertura, calibración, demanda,
          faltantes, café activo e incidencias.
        </p>
      </section>

      {params.saved === "waste" && (
        <p className="card status-ok">Merma registrada.</p>
      )}
      {params.saved === "incident" && (
        <p className="card status-ok">
          Incidencia enviada a operación.
        </p>
      )}
      {typeof params.error === "string" && (
        <p className="alert">
          No se pudo guardar el registro: {params.error}
        </p>
      )}

      {summary.messages.length > 0 && (
        <section className="stack" style={{ marginBottom: "1rem" }}>
          {summary.messages.map((message) => (
            <article
              className={
                message.priority === "IMPORTANT" ? "alert" : "card"
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

      <section className="grid">
        <article className="card">
          <span className="pill">1 · APERTURA</span>
          <div className="metric">
            {summary.opening.completed} / {summary.opening.total}
          </div>
          <p>
            {openingDone
              ? "Apertura completada."
              : summary.opening.next
                ? "Siguiente: " + summary.opening.next.title
                : "Termina lo crítico antes de enfocarte en producción."}
          </p>
          <Link href="/checklists" className="button">
            {openingDone ? "Ver checklist" : "Continuar apertura"}
          </Link>
        </article>

        <article className="card">
          <span className="pill">2 · ESPRESSO</span>
          <div className="metric">
            {cockpit.latestQc
              ? Number(cockpit.latestQc.brewTimeS).toFixed(1) + " s"
              : "PENDIENTE"}
          </div>
          <p className="muted">Espresso estándar 1:2</p>
          {cockpit.latestQc ? (
            <>
              <p className={qcOk ? "status-ok" : "status-warn"}>
                {qcOk ? "QC dentro de especificación" : "Revisar calibración"}
              </p>
              <p className="muted">
                {cockpit.latestQc.doseG} g → {cockpit.latestQc.yieldG} g · ratio{" "}
                1:
                {(
                  Number(cockpit.latestQc.yieldG) /
                  Number(cockpit.latestQc.doseG)
                ).toFixed(2)}
                {" · "}
                {cockpit.latestQc.sensoryRating} ·{" "}
                {time(cockpit.latestQc.createdAt)}
              </p>
              <p className="muted">
                Hoy: {cockpit.calibration.attemptsToday} intento(s) ·{" "}
                {cockpit.calibration.passedToday} aprobado(s)
                {cockpit.calibration.passRate == null
                  ? ""
                  : " · " + cockpit.calibration.passRate.toFixed(0) + "%"}
              </p>
            </>
          ) : (
            <p className="status-warn">
              Falta control de espresso del turno.
            </p>
          )}
          <Link href="/quality/espresso">Abrir Espresso QC →</Link>
        </article>

        <article className="card">
          <span className="pill">3 · DEMANDA CERCANA</span>
          <div className="metric">
            {cockpit.traffic.nextPeak
              ? String(cockpit.traffic.nextPeak.hour).padStart(2, "0") +
                ":00"
              : "—"}
          </div>
          <p>
            {cockpit.traffic.nextPeak
              ? "hora más fuerte dentro de las próximas 3 horas."
              : "sin pico relevante detectado en las próximas 3 horas."}
          </p>
          <p className="muted">
            {cockpit.traffic.dayPeak
              ? "Pico restante del día: " +
                String(cockpit.traffic.dayPeak.hour).padStart(2, "0") +
                ":00 · "
              : ""}
            basado en {cockpit.sampleDays} día(s) comparable(s).
          </p>
        </article>

        <article className="card">
          <span className="pill">4 · RIESGOS DE STOCK</span>
          <div className="metric">{cockpit.shiftRisks.length}</div>
          <p>
            {cockpit.shiftRisks.length === 0
              ? "Sin faltantes previstos para el turno."
              : "insumos requieren revisión contra demanda estimada."}
          </p>
          {cockpit.inventoryCorrectionCount > 0 && (
            <p className="status-warn">
              {cockpit.inventoryCorrectionCount} existencia(s) negativas en
              Loyverse requieren conteo/corrección.
            </p>
          )}
          <Link href="/inventory">Abrir inventario →</Link>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <p className="eyebrow">COLA OPERATIVA</p>
        <h2>Qué hacer ahora</h2>
        <p className="muted">
          Solo muestra pendientes que requieren una acción o revisión. Al
          corregirse el dato, desaparecen automáticamente de esta lista.
        </p>
        {actionQueue.length === 0 ? (
          <p className="status-ok">
            No hay pendientes operativos relevantes con los datos actuales.
          </p>
        ) : (
          <div className="stack">
            {actionQueue.map((action, index) => (
              <div className="task" key={action.area + action.title + index}>
                <div style={{ flex: 1 }}>
                  <div>
                    <span className="pill">{action.area}</span>{" "}
                    <strong>{action.title}</strong>
                  </div>
                  <div
                    className={
                      action.priority === "ACTION"
                        ? "status-warn"
                        : "muted"
                    }
                  >
                    {action.detail}
                  </div>
                </div>
                {action.href && (
                  <Link href={action.href}>
                    <button>
                      {action.priority === "ACTION" ? "Atender" : "Revisar"}
                    </button>
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <p className="eyebrow">DEMANDA PROBABLE · TURNO {shiftLabel}</p>
          <h2>Qué es más probable que pidan</h2>
          <p className="muted">
            Rango operativo a partir del promedio de días comparables; no es
            una cantidad exacta de venta.
          </p>
          {cockpit.topProducts.length === 0 ? (
            <p className="muted">
              Todavía no hay muestra suficiente del mismo día de la semana.
            </p>
          ) : (
            <div className="stack">
              {cockpit.topProducts.slice(0, 7).map((row) => (
                <div className="task" key={row.name}>
                  <strong>{row.name}</strong>
                  <span>≈ {expectedRange(row.expected)} bebida(s)</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">PREPARACIÓN DE ESTACIÓN</p>
          <h2>Qué dejar listo</h2>

          <p className="eyebrow" style={{ marginTop: ".8rem" }}>
            DESECHABLES / CONSUMIBLES
          </p>
          {cockpit.prepConsumables.length === 0 ? (
            <p className="muted">Sin consumo calculable.</p>
          ) : (
            <div className="stack">
              {cockpit.prepConsumables.slice(0, 6).map((row) => (
                <div className="task" key={row.variantExternalId}>
                  <div style={{ flex: 1 }}>
                    <strong>{row.itemName}</strong>
                    <div className="muted">
                      mínimo sugerido por demanda del turno
                    </div>
                  </div>
                  <strong>
                    {number.format(row.prepQuantity)} {row.unitLabel}
                  </strong>
                </div>
              ))}
            </div>
          )}

          <p className="eyebrow" style={{ marginTop: "1rem" }}>
            INGREDIENTES
          </p>
          {cockpit.prepIngredients.length === 0 ? (
            <p className="muted">Sin consumo calculable.</p>
          ) : (
            <div className="stack">
              {cockpit.prepIngredients.slice(0, 5).map((row) => (
                <div className="task" key={row.variantExternalId}>
                  <div style={{ flex: 1 }}>
                    <strong>{row.itemName}</strong>
                    <div className="muted">
                      Consumo estimado {number.format(row.expected)}{" "}
                      {row.unitLabel}
                    </div>
                  </div>
                  <div
                    className={
                      row.remainingAfterForecast < 0 ||
                      row.inventoryNeedsCorrection
                        ? "status-warn"
                        : "status-ok"
                    }
                  >
                    {row.inventoryNeedsCorrection
                      ? "conteo"
                      : number.format(row.inStock) + " " + row.unitLabel}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {(cockpit.unavailableProducts.length > 0 ||
        cockpit.incidents.length > 0) && (
        <section className="grid" style={{ marginTop: "1rem" }}>
          {cockpit.unavailableProducts.length > 0 && (
            <article className="card">
              <p className="eyebrow">NO PROMETER HOY</p>
              <h2>Productos con demanda reciente bloqueados por stock</h2>
              <p className="muted">
                Prioriza productos vendidos recientemente; recetas internas y
                productos sin movimiento reciente no aparecen aquí.
              </p>
              <div className="stack">
                {cockpit.unavailableProducts.slice(0, 8).map((row) => (
                  <div className="task" key={row.variantExternalId}>
                    <div>
                      <strong>{row.itemName}</strong>
                      <div className="status-warn">
                        Falta: {row.blockers.join(", ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )}

          {cockpit.incidents.length > 0 && (
            <article className="card">
              <p className="eyebrow">INCIDENCIAS ABIERTAS</p>
              <h2>Lo que sigue pendiente</h2>
              <div className="stack">
                {cockpit.incidents.map((row) => (
                  <div className="task" key={row.id}>
                    <div>
                      <strong>{row.area ?? "Barra"}</strong>{" "}
                      {row.severity !== "NORMAL" && (
                        <span className="status-warn">{row.severity}</span>
                      )}
                      <div>{row.note}</div>
                      <div className="muted">{time(row.occurredAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <p className="eyebrow">CAFÉ ACTIVO</p>
          {cockpit.activeRoast ? (
            <>
              <h2>{cockpit.activeRoast.lotName}</h2>
              <div className="metric">
                {cockpit.activeRoast.ageDays.toFixed(1)} d
              </div>
              <p>
                Batch <strong>{cockpit.activeRoast.batchCode}</strong>
              </p>
              <p className="muted">
                Si cambia el comportamiento del espresso, registra QC antes de
                mover molino varias veces sin dato.
              </p>
            </>
          ) : (
            <>
              <h2>Sin batch asignado</h2>
              <p className="status-warn">
                Operación no puede relacionar QC con tueste.
              </p>
            </>
          )}
        </article>

        <article className="card">
          <p className="eyebrow">ACCESOS RÁPIDOS</p>
          <h2>Ayudas de barra</h2>
          <div
            style={{
              display: "flex",
              gap: ".7rem",
              flexWrap: "wrap",
            }}
          >
            <Link className="button" href="/recipes">
              Recetario
            </Link>
            <Link className="button" href="/sops">
              SOPs
            </Link>
            <Link className="button" href="/quality/espresso">
              Espresso QC
            </Link>
            <Link className="button" href="/checklists">
              Tareas
            </Link>
          </div>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={reportBarWaste} className="card stack">
          <p className="eyebrow">REGISTRO RÁPIDO</p>
          <h2>Merma / derrame / bebida rehecha</h2>
          <p className="muted">
            No modifica Loyverse. Explica diferencias entre consumo teórico y
            existencia y mejora el detector de mermas.
          </p>
          <label>
            Insumo
            <select name="variantExternalId" required defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {cockpit.wasteOptions.map((row) => (
                <option
                  key={row.variantExternalId}
                  value={row.variantExternalId}
                >
                  {row.itemName} · {row.unitLabel}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantidad
            <input
              name="quantity"
              type="number"
              step="0.001"
              min="0.001"
              required
              placeholder="Usa la unidad mostrada junto al insumo"
            />
          </label>
          <p className="muted">
            Cada insumo muestra su unidad operativa. Si aparece “u. Loyverse”,
            todavía falta configurar su unidad legible en Inventario.
          </p>
          <label>
            Motivo
            <select name="reason" defaultValue="DERRAME">
              <option value="DERRAME">Derrame</option>
              <option value="REMAKE">Bebida rehecha</option>
              <option value="VAPORIZADO">Residual / vaporizado</option>
              <option value="CALIBRACION">Calibración</option>
              <option value="CADUCIDAD">Caducidad</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>
          <label>
            Nota
            <input name="note" maxLength={300} />
          </label>
          <button type="submit">Registrar merma</button>
        </form>

        <form action={reportBarIncident} className="card stack">
          <p className="eyebrow">ESCALAR PROBLEMA</p>
          <h2>Incidencia de barra</h2>
          <p className="muted">
            Úsalo para fallas, faltantes no previstos, calidad o algo que deba
            revisar el siguiente turno / administración.
          </p>
          <label>
            Área
            <select name="area" defaultValue="BARRA">
              <option value="BARRA">Barra</option>
              <option value="ESPRESSO">Máquina / espresso</option>
              <option value="MOLINO">Molino</option>
              <option value="HIELO">Hielo</option>
              <option value="COCINA">Cocina</option>
              <option value="INVENTARIO">Inventario</option>
              <option value="LIMPIEZA">Limpieza</option>
              <option value="CLIENTE">Cliente / servicio</option>
            </select>
          </label>
          <label>
            Prioridad
            <select name="severity" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Importante</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
          <label>
            Qué pasó
            <textarea
              name="note"
              rows={4}
              maxLength={1000}
              required
              placeholder="Describe qué pasó y qué falta hacer."
            />
          </label>
          <button type="submit">Enviar incidencia</button>
        </form>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <span className="pill">ENTREGA</span>
          <div className="metric">
            {summary.handoff.completed} / {summary.handoff.total}
          </div>
          <p>
            {summary.handoff.total > 0 &&
            summary.handoff.completed === summary.handoff.total
              ? "Entrega de turno completada."
              : handoffWindow
                ? "Ya es momento de dejar barra, incidencias y faltantes documentados."
                : "No requiere atención todavía; úsala cerca del final de tu turno."}
          </p>
          <Link href="/handoff">
            {summary.handoff.total > 0 &&
            summary.handoff.completed === summary.handoff.total
              ? "Ver entrega →"
              : handoffWindow
                ? "Completar entrega →"
                : "Ver entrega →"}
          </Link>
        </article>

        <article className="card">
          <span className="pill">INVENTARIO</span>
          <div className="metric">{summary.inventory.openShortages}</div>
          <p>
            {summary.inventory.openShortages === 0
              ? "Sin faltantes abiertos."
              : "Hay faltantes que deben quedar documentados."}
          </p>
          <Link href="/inventory">Abrir inventario →</Link>
        </article>
      </section>
    </main>
  );
}
