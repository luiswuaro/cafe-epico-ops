import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperationalIngredientHistory } from "@/src/application/loyverse/operational-history";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

function dateTime(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function movementLabel(type: string) {
  if (type === "SALE") return "Venta POS";
  if (type === "SALE_REVERSAL") return "Reversa de venta";
  if (type === "RESTOCK") return "Reabasto";
  if (type === "COUNT_ADJUSTMENT") return "Ajuste por conteo";
  if (type === "WASTE") return "Merma";
  if (type === "OPENING_BALANCE") return "Saldo inicial";
  return type;
}

export default async function IngredientHistoryPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  const { variantId } = await params;
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) notFound();

  await assertEmployeePermission(
    employee.id,
    "inventory.read",
    employee.homeStoreId,
  );

  const data = await getOperationalIngredientHistory(
    employee.organizationId,
    employee.homeStoreId,
    variantId,
    30,
  );
  if (!data) notFound();

  const show = (value: number | null) =>
    value == null
      ? "—"
      : number.format(value * data.displayFactor) + " " + data.displayUnit;

  const drift =
    data.currentOpsNative != null && data.currentSourceNative != null
      ? data.currentOpsNative - data.currentSourceNative
      : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · HISTÓRICO 30 DÍAS</p>
        <h1>{data.itemName}</h1>
        <p className="muted">
          {data.sku ? "SKU " + data.sku + " · " : ""}
          saldo operacional, movimientos del POS y referencia histórica de
          Loyverse.
        </p>
        <Link href="/inventory">← Volver a inventario</Link>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">SALDO OPS</span>
          <div className="metric">{show(data.currentOpsNative)}</div>
          <p>Actualizado {dateTime(data.operationalUpdatedAt)}</p>
        </article>
        <article className="card">
          <span className="pill">FUENTE LOYVERSE</span>
          <div className="metric">{show(data.currentSourceNative)}</div>
          <p>Sync {dateTime(data.sourceSyncedAt)}</p>
        </article>
        <article className="card">
          <span className="pill">DIFERENCIA OPS − LOYVERSE</span>
          <div className="metric">{show(drift)}</div>
          <p>
            Durante operación paralela esta diferencia puede incluir ventas
            capturadas en OPS todavía no conciliadas con Loyverse.
          </p>
        </article>
        <article className="card">
          <span className="pill">ÚLTIMO REABASTO / AJUSTE</span>
          <div className="metric history-date">
            {dateTime(data.latestPositiveAt)}
          </div>
          <p>Sirve para detectar insumos que llevan demasiado tiempo sin entrar.</p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Consumo registrado en OPS · 30 días</h2>
        <div className="receipt-audit-grid">
          <div>
            <span className="muted">Por ventas POS</span>
            <strong>{show(data.saleConsumptionNative)}</strong>
          </div>
          <div>
            <span className="muted">Merma registrada</span>
            <strong>{show(data.wasteConsumptionNative)}</strong>
          </div>
          <div>
            <span className="muted">Saldo inicial</span>
            <strong>{show(data.sourceAtInitializationNative)}</strong>
          </div>
          <div>
            <span className="muted">Inicio control OPS</span>
            <strong>{dateTime(data.initializedAt)}</strong>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Movimientos OPS</h2>
        {data.movements.length === 0 ? (
          <p className="muted">Todavía no hay movimientos en este periodo.</p>
        ) : (
          <div className="stack">
            {data.movements.map((movement) => (
              <div className="task" key={movement.id}>
                <div style={{ flex: 1 }}>
                  <strong>{movementLabel(movement.movementType)}</strong>
                  <div className="muted">
                    {dateTime(movement.occurredAt)}
                    {movement.note ? " · " + movement.note : ""}
                  </div>
                </div>
                <strong
                  className={
                    movement.quantityDeltaNative < 0
                      ? "status-warn"
                      : "status-ok"
                  }
                >
                  {movement.quantityDeltaNative > 0 ? "+" : ""}
                  {show(movement.quantityDeltaNative)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Existencia reportada por Loyverse</h2>
        <p className="muted">
          Puntos capturados cuando cambia la existencia; no se inventan puntos
          entre sincronizaciones.
        </p>
        {data.snapshots.length === 0 ? (
          <p className="muted">Sin cambios capturados en los últimos 30 días.</p>
        ) : (
          <div className="stack">
            {data.snapshots.map((snapshot, index) => (
              <div
                className="task"
                key={snapshot.capturedAt.toISOString() + "-" + index}
              >
                <span>{dateTime(snapshot.capturedAt)}</span>
                <strong>{show(snapshot.quantityNative)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
