import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryConsumptionChart } from "@/components/inventory-consumption-chart";
import { getInventoryItemHistory } from "@/src/application/inventory/history";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

const movementLabels: Record<string, string> = {
  PURCHASE: "Compra",
  SALE: "Venta / receta",
  WASTE: "Merma",
  PRODUCTION_CONSUMPTION: "Consumo producción",
  PRODUCTION_OUTPUT: "Producción",
  TRANSFER_IN: "Transferencia entrada",
  TRANSFER_OUT: "Transferencia salida",
  COUNT_ADJUSTMENT: "Ajuste por conteo",
  MANUAL_ADJUSTMENT: "Ajuste manual",
  OPENING_BALANCE: "Saldo inicial",
};

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    return (
      <main className="shell">
        <p className="alert">Empleado sin sucursal asignada.</p>
      </main>
    );
  }

  await assertEmployeePermission(
    employee.id,
    "inventory.read",
    employee.homeStoreId,
  );

  const history = await getInventoryItemHistory(
    employee.organizationId,
    employee.homeStoreId,
    id,
    30,
  );

  if (!history) notFound();

  const unit = history.item.canonicalUnit;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · HISTÓRICO</p>
        <h1>{history.item.name}</h1>
        <p className="muted">
          {history.item.category} · unidad canónica {unit}
        </p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/inventory">← Volver a inventario</Link>
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">TEÓRICO ACTUAL</span>
          <div className="metric">
            {number.format(history.theoreticalQuantity)} {unit}
          </div>
        </article>

        <article className="card">
          <span className="pill">CONSUMO 30 DÍAS</span>
          <div className="metric">
            {number.format(history.totalConsumption)} {unit}
          </div>
        </article>

        <article className="card">
          <span className="pill">PROMEDIO DIARIO</span>
          <div className="metric">
            {number.format(history.averageDailyConsumption)} {unit}
          </div>
        </article>

        <article className="card">
          <span className="pill">COBERTURA</span>
          <div className="metric">
            {history.daysCoverage == null
              ? "—"
              : `${history.daysCoverage.toFixed(1)} d`}
          </div>
          <p className="muted">
            Teórico actual ÷ consumo promedio diario.
          </p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Consumo diario · últimos 30 días</h2>
        <InventoryConsumptionChart
          points={history.points}
          unit={unit}
        />
        {history.totalConsumption === 0 && (
          <p className="muted">
            La gráfica empezará a llenarse cuando existan movimientos de venta,
            merma o consumo de producción. No contamos transferencias ni ajustes
            como consumo.
          </p>
        )}
        {history.totalWaste > 0 && (
          <p>
            Merma acumulada:{" "}
            <strong>
              {number.format(history.totalWaste)} {unit}
            </strong>
          </p>
        )}
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2>Últimos conteos físicos</h2>
          {history.recentCounts.length === 0 ? (
            <p className="muted">Todavía no hay conteos cerrados para este insumo.</p>
          ) : (
            <div className="stack">
              {history.recentCounts.map((count) => (
                <div className="task" key={count.id}>
                  <div style={{ flex: 1 }}>
                    <strong>
                      {count.physicalQuantity} {unit}
                    </strong>
                    <div className="muted">
                      {count.locationName} · teórico en ese conteo{" "}
                      {count.theoreticalQuantitySnapshot} {unit} · Δ{" "}
                      {Number(count.deviationQuantity) > 0 ? "+" : ""}
                      {count.deviationQuantity} {unit}
                    </div>
                    <div className="muted">
                      {count.countedAt.toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Movimientos recientes</h2>
          {history.recentMovements.length === 0 ? (
            <p className="muted">
              Todavía no hay movimientos para este insumo.
            </p>
          ) : (
            <div className="stack">
              {history.recentMovements.map((movement) => {
                const delta = Number(movement.quantityDelta);
                return (
                  <div className="task" key={movement.id}>
                    <div style={{ flex: 1 }}>
                      <strong>
                        {movementLabels[movement.movementType] ??
                          movement.movementType}
                      </strong>
                      <div>
                        {delta > 0 ? "+" : ""}
                        {number.format(delta)} {unit}
                      </div>
                      <div className="muted">
                        {movement.locationName}
                        {movement.note ? ` · ${movement.note}` : ""}
                      </div>
                      <div className="muted">
                        {movement.occurredAt.toLocaleString("es-MX", {
                          timeZone: "America/Mexico_City",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
