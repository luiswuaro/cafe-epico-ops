import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryConsumptionChart } from "@/components/inventory-consumption-chart";
import { InventoryStockHistoryChart } from "@/components/inventory-stock-history-chart";
import { getLoyverseIngredientHistory } from "@/src/application/inventory/loyverse-history";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

function time(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function movementLabel(value: string) {
  if (value === "SALE") return "Venta POS";
  if (value === "SALE_REVERSAL") return "Reversa de venta";
  if (value === "OPENING_BALANCE") return "Saldo inicial";
  if (value === "WASTE") return "Merma";
  return value;
}

export default async function InventoryIngredientHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) notFound();

  await assertEmployeePermission(
    employee.id,
    "inventory.read",
    employee.homeStoreId,
  );

  const history = await getLoyverseIngredientHistory(
    employee.organizationId,
    employee.homeStoreId,
    id,
    60,
  );

  if (!history) notFound();

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · HISTÓRICO POR INSUMO</p>
        <h1>{history.item.itemName}</h1>
        <p className="muted">
          Saldo operativo de OPS, espejo de Loyverse, consumo por ventas y
          reposiciones detectadas. Ventana: {history.periodDays} días.
        </p>
        <Link href="/inventory">← Volver a inventario</Link>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">SALDO OPS</span>
          <div className="metric">
            {history.operational.current == null
              ? "—"
              : number.format(history.operational.current) +
                " " +
                history.displayUnit}
          </div>
          <p>
            actualizado {time(history.operational.updatedAt)}
          </p>
        </article>

        <article className="card">
          <span className="pill">FUENTE LOYVERSE</span>
          <div className="metric">
            {history.source.current == null
              ? "—"
              : number.format(history.source.current) +
                " " +
                history.displayUnit}
          </div>
          <p>sincronizado {time(history.source.syncedAt)}</p>
        </article>

        <article className="card">
          <span className="pill">DIFERENCIA OPS / LOYVERSE</span>
          <div className="metric">
            {history.operational.driftVsSource == null
              ? "—"
              : (history.operational.driftVsSource > 0 ? "+" : "") +
                number.format(history.operational.driftVsSource) +
                " " +
                history.displayUnit}
          </div>
          <p>
            sirve para reconciliar mientras ambos sistemas conviven.
          </p>
        </article>

        <article className="card">
          <span className="pill">ÚLTIMA REPOSICIÓN DETECTADA</span>
          <div className="metric">
            {history.source.daysSinceLastRestock == null
              ? "—"
              : history.source.daysSinceLastRestock + " d"}
          </div>
          <p>
            {history.source.lastRestockAt
              ? time(history.source.lastRestockAt)
              : "Sin subida de stock detectada en la ventana disponible."}
          </p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Existencia fuente</h2>
        <p className="muted">
          Histórico de capturas sincronizadas desde Loyverse. Una subida de
          stock se interpreta únicamente como reposición detectada; no
          presupone proveedor ni motivo.
        </p>
        <InventoryStockHistoryChart
          points={history.source.points}
          unit={history.displayUnit}
        />
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Consumo descontado por OPS</h2>
        <p className="muted">
          Sale de las recetas de órdenes pagadas en el POS. Las cancelaciones
          completas generan una reversa separada.
        </p>
        <InventoryConsumptionChart
          points={history.operational.daily}
          unit={history.displayUnit}
        />
        <div className="grid" style={{ marginTop: ".8rem" }}>
          <div className="task">
            <div>
              <strong>Consumo acumulado</strong>
              <div>
                {number.format(history.operational.totalConsumption)}{" "}
                {history.displayUnit}
              </div>
            </div>
          </div>
          <div className="task">
            <div>
              <strong>Promedio diario OPS</strong>
              <div>
                {number.format(
                  history.operational.averageDailyConsumption,
                )}{" "}
                {history.displayUnit}
              </div>
            </div>
          </div>
          <div className="task">
            <div>
              <strong>Cambio neto fuente</strong>
              <div>
                {history.source.netChange > 0 ? "+" : ""}
                {number.format(history.source.netChange)}{" "}
                {history.displayUnit}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Movimientos OPS</h2>
          {history.operational.movements.length === 0 ? (
            <p className="muted">Sin movimientos OPS en esta ventana.</p>
          ) : (
            <div className="stack">
              {history.operational.movements.slice(0, 50).map((row) => (
                <div className="task" key={row.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{movementLabel(row.movementType)}</strong>
                    <div className="muted">
                      {time(row.occurredAt)}
                      {row.note ? " · " + row.note : ""}
                    </div>
                  </div>
                  <strong>
                    {row.quantityDelta > 0 ? "+" : ""}
                    {number.format(row.quantityDelta)}{" "}
                    {history.displayUnit}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <h2>Cambios del stock fuente</h2>
          {history.source.changes.length === 0 ? (
            <p className="muted">
              Sin cambios detectados en las capturas disponibles.
            </p>
          ) : (
            <div className="stack">
              {history.source.changes.slice(0, 50).map((row, index) => (
                <div
                  className="task"
                  key={row.at.toISOString() + "-" + index}
                >
                  <div style={{ flex: 1 }}>
                    <strong>{time(row.at)}</strong>
                    <div className="muted">
                      {number.format(row.before)} →{" "}
                      {number.format(row.after)} {history.displayUnit}
                    </div>
                  </div>
                  <strong>
                    {row.delta > 0 ? "+" : ""}
                    {number.format(row.delta)} {history.displayUnit}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
