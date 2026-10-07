import Link from "next/link";
import { markEmployeeMessageRead } from "@/app/actions/messages";
import {
  reportBarIncident,
  reportBarWaste,
  reportQuickStockCount,
} from "./actions";
import { buildBaristaActionQueue } from "@/src/application/barista/action-queue";
import { getBaristaCockpit } from "@/src/application/barista/cockpit";
import { getLatestCompletedHandoffSummary } from "@/src/application/barista/previous-handoff";
import { getTodayOperationalSummary } from "@/src/application/dashboard/today";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 2,
});

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
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

function operationalUnit(unit: string) {
  return unit === "u. Loyverse" || unit === "peso/volumen"
    ? "unidad sin configurar"
    : unit;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();
  const [summary, cockpit, previousHandoff] = await Promise.all([
    getTodayOperationalSummary(employee),
    getBaristaCockpit(employee),
    getLatestCompletedHandoffSummary(
      employee.organizationId,
      employee.homeStoreId ?? null,
    ),
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
  const selectedCountVariant =
    typeof params.count === "string" ? params.count : "";
  const quickAction =
    typeof params.action === "string" ? params.action : "";
  const suggestedCountRows = cockpit.countOptions
    .filter((row) => row.sourceQuantity < 0 && !row.countedToday)
    .slice(0, 6);

  const blockedByIngredient = Array.from(
    cockpit.unavailableProducts.reduce((groups, row) => {
      for (const blocker of row.blockers) {
        const products = groups.get(blocker) ?? [];
        products.push(row.itemName);
        groups.set(blocker, products);
      }
      return groups;
    }, new Map<string, string[]>()),
  )
    .map(([ingredient, products]) => ({
      ingredient,
      products: Array.from(new Set(products)),
    }))
    .sort(
      (a, b) =>
        b.products.length - a.products.length ||
        a.ingredient.localeCompare(b.ingredient, "es"),
    );

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
    lossSummary: cockpit.lossSummary,
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
      {params.saved === "stock-count" && (
        <p
          className={
            params.reconcile === "1" ? "alert" : "card status-ok"
          }
        >
          {params.reconcile === "1"
            ? "Conteo guardado. La diferencia quedó pendiente para conciliación administrativa con Loyverse."
            : "Conteo guardado y sin diferencia relevante contra Loyverse."}
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

      <section className="grid today-kpis">
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
              {cockpit.inventoryCorrectionCount} insumo(s) requieren
              confirmación física.
            </p>
          )}
          {cockpit.inventoryCorrectionSubmitted > 0 && (
            <p className="muted">
              {cockpit.inventoryCorrectionSubmitted} ya contada(s) hoy y
              pendiente(s) de conciliación cuando aplique.
            </p>
          )}
          <Link
            href={
              cockpit.inventoryCorrectionCount > 0
                ? "/today?action=count#conteo-rapido"
                : "/inventory"
            }
          >
            {cockpit.inventoryCorrectionCount > 0
              ? "Contar existencias →"
              : "Abrir inventario →"}
          </Link>
        </article>
      </section>

      {previousHandoff && (
        <section className="card previous-handoff" style={{ marginTop: "1rem" }}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">CONTINUIDAD · TURNO ANTERIOR</p>
              <h2>Así se entregó el último turno cerrado</h2>
            </div>
            <span className="pill">{previousHandoff.businessDate}</span>
          </div>

          <div className="previous-handoff-grid">
            <div className="previous-handoff-owner">
              <strong>{previousHandoff.employeeName}</strong>
              <span className="muted">
                Cerró{" "}
                {previousHandoff.completedAt
                  ? time(previousHandoff.completedAt)
                  : "sin hora registrada"}
              </span>
            </div>

            <div>
              <span className="previous-handoff-value">
                {previousHandoff.completedTasks}/{previousHandoff.taskCount}
              </span>
              <span className="muted"> tareas</span>
            </div>

            <div>
              <span className="previous-handoff-value">
                {previousHandoff.onTargetRate == null
                  ? "—"
                  : Math.round(previousHandoff.onTargetRate) + "%"}
              </span>
              <span className="muted"> dentro de objetivo</span>
            </div>

            <div>
              <span className="previous-handoff-value">
                {cockpit.incidents.length}
              </span>
              <span className="muted"> incidencia(s) abierta(s) ahora</span>
            </div>
          </div>

          {previousHandoff.closingNote ? (
            <div className="handoff-note-preview previous-handoff-note">
              <strong>Nota de entrega:</strong> {previousHandoff.closingNote}
            </div>
          ) : (
            <p className="muted compact-copy">
              El turno cerró sin nota general.
              {previousHandoff.taskNotes > 0
                ? " Hay " +
                  previousHandoff.taskNotes +
                  " nota(s) dentro de tareas."
                : ""}
            </p>
          )}
        </section>
      )}

      <section className="card command-center" style={{ marginTop: "1rem" }}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">CENTRO DE MANDO · TURNO {shiftLabel}</p>
            <h2>Qué hacer ahora</h2>
          </div>
          <span className="queue-count">
            {actionQueue.length} pendiente{actionQueue.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="muted compact-copy">
          Prioridad calculada con apertura, QC, inventario, demanda,
          incidencias y entrega. Al corregirse el dato, desaparece de aquí.
        </p>
        {actionQueue.length === 0 ? (
          <p className="status-ok">
            Sin acciones operativas relevantes con los datos actuales.
          </p>
        ) : (
          <div className="queue-list">
            {actionQueue.map((action, index) => (
              <div
                className={"queue-row priority-" + action.priority.toLowerCase()}
                key={action.area + action.title + index}
              >
                <span className="queue-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="queue-body">
                  <div className="queue-title">
                    <span className="pill">{action.area}</span>
                    <strong>{action.title}</strong>
                  </div>
                  <div className="queue-detail">{action.detail}</div>
                </div>
                {action.href && (
                  <Link className="queue-action" href={action.href}>
                    {index === 0 && action.priority === "ACTION"
                      ? "Hacer ahora"
                      : action.priority === "ACTION"
                        ? "Atender"
                        : "Revisar"}
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
                    {number.format(row.prepQuantity)} {operationalUnit(row.unitLabel)}
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
                      {operationalUnit(row.unitLabel)}
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
                      : number.format(row.inStock) + " " + operationalUnit(row.unitLabel)}
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
              <p className="eyebrow">RIESGO DE MENÚ</p>
              <h2>Productos comprometidos por inventario</h2>
              <p className="muted compact-copy">
                Agrupado por insumo para ver qué reposición recupera más
                productos del menú.
              </p>
              <div className="stack compact-stack">
                {blockedByIngredient.slice(0, 6).map((group) => (
                  <div className="blocker-row" key={group.ingredient}>
                    <div>
                      <strong>{group.ingredient}</strong>
                      <div className="muted">
                        Afecta {group.products.length} producto
                        {group.products.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="blocker-products">
                      {group.products.slice(0, 4).join(" · ")}
                      {group.products.length > 4
                        ? " · +" + (group.products.length - 4)
                        : ""}
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
          <p className="eyebrow">CAFÉ EN TOLVA</p>
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
              <h2>Sin batch confirmado en OPS</h2>
              <p className="status-warn">
                Confirma el batch antes de interpretar QC contra reposo y tueste.
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
        <article className="card">
          <p className="eyebrow">CALIDAD DEL TURNO</p>
          <h2>Merma registrada</h2>
          <div className="metric">{cockpit.lossSummary.wasteEvents}</div>
          <p>evento(s) de merma hoy.</p>
          <p className="muted">
            Costo estimado de merma:{" "}
            {money.format(cockpit.lossSummary.estimatedWasteCost)}.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">CALIDAD DE SERVICIO</p>
          <h2>Bebidas rehechas</h2>
          <div className="metric">{cockpit.lossSummary.remakeEvents}</div>
          <p>
            {cockpit.lossSummary.remakeRate == null
              ? "Sin base de ventas sincronizada para calcular tasa."
              : cockpit.lossSummary.remakeRate.toFixed(1) +
                "% de las bebidas vendidas sincronizadas hoy."}
          </p>
          <p className="muted">
            Base de bebidas sincronizada:{" "}
            {number.format(cockpit.lossSummary.soldUnitsToday)} bebida(s) ·
            costo de insumo asociado ≈{" "}
            {money.format(cockpit.lossSummary.estimatedRemakeCost)}.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">CONTEOS DEL TURNO</p>
          <h2>Verificación física</h2>
          <div className="metric">{cockpit.stockCountsToday.length}</div>
          <p>insumo(s) contado(s) hoy.</p>
          <p className="muted">
            {
              cockpit.stockCountsToday.filter((row) => row.pendingAdmin)
                .length
            }{" "}
            con diferencia pendiente de conciliación.
          </p>
        </article>
      </section>

      {cockpit.lossSummary.topLosses.length > 0 && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">DETALLE DE MERMAS / REMAKES</p>
          <h2>Qué se ha perdido hoy</h2>
          <div className="stack">
            {cockpit.lossSummary.topLosses.map((row) => (
              <div
                className="task"
                key={row.itemName + row.displayUnit}
              >
                <div style={{ flex: 1 }}>
                  <strong>{row.itemName}</strong>
                  <div className="muted">
                    {row.events} registro(s)
                    {row.remakes > 0
                      ? " · " + row.remakes + " remake(s)"
                      : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>
                    {number.format(row.displayQuantity)} {operationalUnit(row.displayUnit)}
                  </strong>
                  {row.estimatedCost > 0 && (
                    <div className="muted">
                      ≈ {money.format(row.estimatedCost)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card quick-actions" style={{ marginTop: "1rem" }}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">ACCIONES RÁPIDAS</p>
            <h2>Registrar sin salir de Hoy</h2>
          </div>
          <div className="quick-action-links">
            <Link href="/today?action=count#conteo-rapido">+ Conteo</Link>
            <Link href="/today?action=waste#registro-merma">+ Merma</Link>
            <Link href="/today?action=incident#incidencia-barra">+ Incidencia</Link>
          </div>
        </div>
        <div className="quick-action-grid">
          <details
            className="quick-panel"
            id="conteo-rapido"
            open={quickAction === "count"}
          >
            <summary>
              <span>Conteo físico</span>
              <small>Confirmar existencia</small>
            </summary>
            <form
              action={reportQuickStockCount}
              className="stack quick-form"
            >
          <p className="eyebrow">CONTEO RÁPIDO</p>
          <h2>Confirmar existencia física</h2>
          <p className="muted">
            Registra lo que realmente hay. No modifica Loyverse; si existe una
            diferencia, administración recibe el pendiente para conciliarlo.
          </p>
          {suggestedCountRows.length > 0 && (
            <div>
              <p className="eyebrow">CONTAR PRIMERO</p>
              <div
                style={{
                  display: "flex",
                  gap: ".5rem",
                  flexWrap: "wrap",
                }}
              >
                {suggestedCountRows.map((row) => (
                  <Link
                    className="button"
                    key={row.variantExternalId}
                    href={
                      "/today?action=count&count=" +
                      encodeURIComponent(row.variantExternalId) +
                      "#conteo-rapido"
                    }
                  >
                    {row.itemName}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <label>
            Insumo
            <select
              name="variantExternalId"
              required
              defaultValue={selectedCountVariant}
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {cockpit.countOptions.map((row) => (
                <option
                  key={row.variantExternalId}
                  value={row.variantExternalId}
                >
                  {row.itemName} · Loyverse{" "}
                  {number.format(row.sourceQuantity)}{" "}
                  {operationalUnit(row.unitLabel)}
                  {row.countedToday ? " · contado hoy" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conteo físico
            <input
              name="physicalQuantity"
              type="number"
              min="0"
              step="0.001"
              required
              placeholder="Cantidad real en la unidad indicada arriba"
            />
          </label>
          <label>
            Nota opcional
            <input
              name="note"
              maxLength={300}
              placeholder="Ej. caja abierta, producto en almacén, etc."
            />
          </label>
          <button type="submit">Guardar conteo físico</button>

          {cockpit.stockCountsToday.length > 0 && (
            <div className="stack" style={{ marginTop: ".5rem" }}>
              {cockpit.stockCountsToday.slice(0, 4).map((row) => (
                <div className="task" key={row.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{row.itemName}</strong>
                    <div className="muted">
                      físico{" "}
                      {row.physicalQuantity == null
                        ? "—"
                        : number.format(row.physicalQuantity)}{" "}
                      {row.displayUnit}
                    </div>
                  </div>
                  <span
                    className={
                      row.pendingAdmin ? "status-warn" : "status-ok"
                    }
                  >
                    {row.pendingAdmin ? "conciliar" : "coincide"}
                  </span>
                </div>
              ))}
            </div>
          )}
            </form>
          </details>

          <details
            className="quick-panel"
            id="registro-merma"
            open={quickAction === "waste"}
          >
            <summary>
              <span>Merma / remake</span>
              <small>Registrar pérdida</small>
            </summary>
            <form
              action={reportBarWaste}
              className="stack quick-form"
            >
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
                  {row.itemName} · {operationalUnit(row.unitLabel)}
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
            Usa la unidad indicada. Si aparece “unidad sin configurar”,
            primero corrige la unidad operativa en Inventario. Un remake se
            registra una sola vez con el insumo principal perdido.
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
          </details>

          <details
            className="quick-panel"
            id="incidencia-barra"
            open={quickAction === "incident"}
          >
            <summary>
              <span>Incidencia</span>
              <small>Escalar un problema</small>
            </summary>
            <form action={reportBarIncident} className="stack quick-form">
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
          </details>
        </div>
      </section>

      <section className="grid compact-footer-grid" style={{ marginTop: "1rem" }}>
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
