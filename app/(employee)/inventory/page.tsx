import Link from "next/link";
import { refreshLoyverseInventorySource } from "./loyverse-actions";
import { reportShortage, resolveShortage } from "./actions";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { listOpenShortages } from "@/src/application/inventory/shortages";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function coverageLabel(days: number | null) {
  if (days == null) return "sin consumo calculable";
  if (!Number.isFinite(days)) return "sin consumo calculable";
  if (days > 99) return ">99 días";
  return `${days.toFixed(1)} días`;
}

function displayQuantity(
  value: number,
  displayFactor: number | null | undefined,
) {
  return value * (displayFactor ?? 1);
}

function displayUnit(
  unitLabel: string,
  configuredUnit: string | null | undefined,
) {
  if (configuredUnit) return configuredUnit;
  return unitLabel === "peso/volumen" ? "unidad Loyverse" : unitLabel;
}

function statusLabel(status: "CRITICAL" | "WATCH" | "OK" | "NO_DATA") {
  if (status === "CRITICAL") return "CRÍTICO";
  if (status === "WATCH") return "REVISAR";
  if (status === "OK") return "OK";
  return "SIN DATO";
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedStore =
    typeof params.store === "string" ? params.store : undefined;

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

  const [inventory, shortages, canResolve, canSync] = await Promise.all([
    getInventoryIntelligence(employee.organizationId, requestedStore),
    listOpenShortages(employee.organizationId, employee.homeStoreId),
    employeeHasPermission(
      employee.id,
      "inventory.shortage.resolve",
      employee.homeStoreId,
    ),
    employeeHasPermission(
      employee.id,
      "integration.manage",
      employee.homeStoreId,
    ),
  ]);

  const groups = new Map<string, typeof inventory.rows>();
  for (const row of inventory.rows) {
    const current = groups.get(row.category) ?? [];
    current.push(row);
    groups.set(row.category, current);
  }

  const error = typeof params.error === "string" ? params.error : null;
  const refreshed = params.refreshed === "1";

  const pendingOperationalUnits = inventory.rows.filter(
    (row) =>
      row.unitLabel === "peso/volumen" &&
      !row.displayUnit,
  ).length;

  const lastRestockByVariant = new Map<string, Date>();
  for (const change of inventory.recentChanges) {
    if (change.delta <= 0) continue;
    if (!lastRestockByVariant.has(change.variantExternalId)) {
      lastRestockByVariant.set(
        change.variantExternalId,
        change.capturedAt,
      );
    }
  }

  const lagRows = inventory.smartRows
    .filter((row) => row.avgDailyUsage14 > 0.0005)
    .map((row) => {
      const sourceRestockAt =
        lastRestockByVariant.get(row.variantExternalId) ?? null;
      const opsRestockAt = row.lastOperationalRestockAt ?? null;
      const lastRestockAt =
        sourceRestockAt && opsRestockAt
          ? sourceRestockAt > opsRestockAt
            ? sourceRestockAt
            : opsRestockAt
          : sourceRestockAt ?? opsRestockAt;

      return {
        row,
        lastRestockAt,
        restockSource:
          lastRestockAt == null
            ? null
            : opsRestockAt && lastRestockAt === opsRestockAt
              ? ("OPS" as const)
              : ("LOYVERSE" as const),
      };
    })
    .sort((a, b) => {
      if (!a.lastRestockAt && b.lastRestockAt) return -1;
      if (a.lastRestockAt && !b.lastRestockAt) return 1;
      if (!a.lastRestockAt || !b.lastRestockAt) {
        return a.row.daysCover == null
          ? 1
          : b.row.daysCover == null
            ? -1
            : a.row.daysCover - b.row.daysCover;
      }
      return (
        a.lastRestockAt.getTime() - b.lastRestockAt.getTime()
      );
    })
    .slice(0, 10);

  const operationalBalances = inventory.rows.filter(
    (row) => row.operationalInStock != null,
  ).length;

  const lagRows = inventory.smartRows
    .filter((row) => row.status === "CRITICAL" || row.status === "WATCH")
    .slice(0, 12);

  const purchaseRows = inventory.smartRows
    .filter((row) => row.suggestedPurchase > 0.0005)
    .slice(0, 20);

  const tomorrowRows = inventory.smartRows
    .filter((row) => row.expectedTomorrow > 0.0005)
    .sort((a, b) => b.expectedTomorrow - a.expectedTomorrow)
    .slice(0, 15);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · LOYVERSE + INTELIGENCIA</p>
        <h1>Inventario operativo</h1>
        <p className="muted">
          OPS conserva un saldo operativo independiente y descuenta las
          recetas de las ventas pagadas. Loyverse queda como fuente de
          comparación, sincronización e historial externo.
        </p>
      </section>

      {refreshed && (
        <p className="card status-ok">
          Actualización completa · {String(params.items ?? "0")} artículos ·{" "}
          {String(params.levels ?? "0")} existencias ·{" "}
          {String(params.receipts ?? "0")} tickets revisados.
        </p>
      )}

      {error && <p className="alert">No se pudo actualizar: {error}</p>}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            gap: ".75rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {inventory.stores.map((store) => (
            <Link
              key={store.externalId}
              href={"/inventory?store=" + store.externalId}
              className={
                inventory.selectedStore?.externalId === store.externalId
                  ? "button"
                  : undefined
              }
            >
              {store.name}
            </Link>
          ))}

          {canSync && (
            <form action={refreshLoyverseInventorySource}>
              <button type="submit">
                Actualizar Loyverse + ventas ahora
              </button>
            </form>
          )}
        </div>
        <p className="muted" style={{ marginTop: ".6rem" }}>
          Este botón actualiza sólo el espejo de Loyverse y su histórico.
          No sobrescribe ni suma el saldo operativo de OPS.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">INSUMOS CONTROLADOS</span>
          <div className="metric">{inventory.rows.length}</div>
          <p>{inventory.selectedStore?.name ?? "Sin tienda seleccionada"}</p>
        </article>

        <article className="card">
          <span className="pill">REQUIEREN ATENCIÓN</span>
          <div className="metric">{inventory.summary.atRisk}</div>
          <p>menos de 3 días de cobertura o saldo OPS crítico.</p>
        </article>

        <article className="card">
          <span className="pill">REPOSICIÓN SUGERIDA</span>
          <div className="metric">{inventory.summary.suggestedPurchases}</div>
          <p>insumos para llevar aproximadamente a 7 días de cobertura.</p>
        </article>

        <article className="card">
          <span className="pill">UNIDADES POR CONFIGURAR</span>
          <div className="metric">{pendingOperationalUnits}</div>
          <p>
            insumos por peso/volumen que aún no deben interpretarse como g, kg,
            ml o L.
          </p>
        </article>

        <article className="card">
          <span className="pill">SALDOS OPS ACTIVOS</span>
          <div className="metric">{operationalBalances}</div>
          <p>
            variantes con saldo operativo independiente del espejo de Loyverse.
          </p>
        </article>

        <article className="card">
          <span className="pill">COSTO ESTIMADO</span>
          <div className="metric">
            {money.format(inventory.summary.estimatedReplenishmentCost)}
          </div>
          <p>solo suma insumos con costo configurado en Loyverse.</p>
        </article>
      </section>

      {pendingOperationalUnits > 0 && (
        <p className="alert" style={{ marginTop: "1rem" }}>
          Inventario todavía no listo para sustituir Loyverse: hay{" "}
          <strong>{pendingOperationalUnits}</strong> insumos por peso/volumen
          sin unidad operativa confirmada.
        </p>
      )}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Históricos y rezago</h2>
        <p className="muted">
          Abre cualquier insumo para ver saldo OPS, referencia de Loyverse,
          movimientos por ventas, ajustes y cambios de existencia de los últimos
          30 días.
        </p>
        {lagRows.length === 0 ? (
          <p className="status-ok">No hay insumos críticos o en revisión.</p>
        ) : (
          <div className="stack">
            {lagRows.map((row) => (
              <div className="task" key={"lag-" + row.variantExternalId}>
                <div style={{ flex: 1 }}>
                  <strong>{row.itemName}</strong>{" "}
                  <span className="status-warn">
                    {statusLabel(row.status)}
                  </span>
                  <div className="muted">
                    cobertura {coverageLabel(row.daysCover)}
                    {" · "}
                    último reabasto OPS{" "}
                    {row.lastOperationalRestockAt
                      ? row.lastOperationalRestockAt.toLocaleDateString("es-MX", {
                          timeZone: "America/Mexico_City",
                        })
                      : "sin registro"}
                  </div>
                </div>
                <Link
                  className="button secondary"
                  href={
                    "/inventory/history/" +
                    encodeURIComponent(row.variantExternalId)
                  }
                >
                  Ver histórico
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Qué revisar antes de mañana</h2>
        <p className="muted">
          Pronóstico por recetas vendidas. Usa promedio de este mismo día de la
          semana cuando hay al menos 2 muestras; si no, promedio de 14 días.
          Los cálculos usan la unidad nativa de Loyverse; la pantalla convierte
          a la unidad operativa configurada cuando existe.
        </p>

        {tomorrowRows.length === 0 ? (
          <p className="muted">
            Todavía no hay ventas/recetas suficientes para pronosticar consumo.
          </p>
        ) : (
          <div className="stack">
            {tomorrowRows.map((row) => (
              <div className="task" key={row.variantExternalId}>
                <div style={{ flex: 1 }}>
                  <Link href={"/inventory/items/" + row.variantExternalId}>
                  <strong>{row.itemName}</strong>
                </Link>{" "}
                  <span
                    className={
                      row.status === "CRITICAL" || row.status === "WATCH"
                        ? "status-warn"
                        : "status-ok"
                    }
                  >
                    {statusLabel(row.status)}
                  </span>
                  <div className="muted">
                    Actual {number.format(displayQuantity(row.inStock, row.displayFactor))} {displayUnit(row.unitLabel, row.displayUnit)}
                    {" · "}
                    cobertura {coverageLabel(row.daysCover)}
                  </div>
                  <div>
                    Mañana esperado:{" "}
                    <strong>
                      {number.format(displayQuantity(row.expectedTomorrow, row.displayFactor))} {displayUnit(row.unitLabel, row.displayUnit)}
                    </strong>
                    {" · "}
                    mañana/primer turno{" "}
                    {number.format(displayQuantity(row.expectedTomorrowMorning, row.displayFactor))}
                    {" · "}
                    tarde{" "}
                    {number.format(displayQuantity(row.expectedTomorrowAfternoon, row.displayFactor))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Reposición / rezago</h2>
        <p className="muted">
          Insumos con consumo reciente, priorizados por ausencia o antigüedad
          del último reabasto registrado en OPS o de una subida de stock
          detectada en Loyverse. No se atribuye proveedor ni motivo sin un
          movimiento registrado.
        </p>
        {lagRows.length === 0 ? (
          <p className="muted">
            Todavía no hay consumo suficiente para evaluar rezago.
          </p>
        ) : (
          <div className="stack">
            {lagRows.map(({ row, lastRestockAt, restockSource }) => (
              <div className="task" key={row.variantExternalId}>
                <div style={{ flex: 1 }}>
                  <Link href={"/inventory/items/" + row.variantExternalId}>
                    <strong>{row.itemName}</strong>
                  </Link>
                  <div className="muted">
                    {lastRestockAt
                      ? (restockSource === "OPS"
                          ? "Último reabasto registrado OPS "
                          : "Última subida de stock detectada en Loyverse ") +
                        lastRestockAt.toLocaleString("es-MX", {
                          timeZone: "America/Mexico_City",
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "Sin reabasto ni subida de stock detectada en la ventana disponible"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>{coverageLabel(row.daysCover)}</strong>
                  <div className="muted">de cobertura OPS</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Lista de reposición sugerida</h2>
        <p className="muted">
          Objetivo automático: aproximadamente 7 días de cobertura, o el stock
          óptimo de Loyverse cuando esté configurado.
        </p>

        {purchaseRows.length === 0 ? (
          <p className="status-ok">
            Con los datos actuales no hay reposición sugerida.
          </p>
        ) : (
          <div className="stack">
            {purchaseRows.map((row) => (
              <div className="task" key={row.variantExternalId}>
                <div style={{ flex: 1 }}>
                  <strong>{row.itemName}</strong>
                  <div className="muted">
                    Actual {number.format(displayQuantity(row.inStock, row.displayFactor))} {displayUnit(row.unitLabel, row.displayUnit)}
                    {" · "}
                    consumo/día {number.format(displayQuantity(row.avgDailyUsage14, row.displayFactor))}
                    {" · "}
                    cobertura {coverageLabel(row.daysCover)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>
                    +{number.format(displayQuantity(row.suggestedPurchase, row.displayFactor))} {displayUnit(row.unitLabel, row.displayUnit)}
                  </strong>
                  {row.suggestedCost != null && (
                    <div className="muted">
                      ≈ {money.format(row.suggestedCost)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Histórico reciente · fuente Loyverse</h2>
        <p className="muted">
          Cada actualización de Loyverse guarda un punto cuando la existencia
          cambia. El histórico individual de cada insumo también muestra el
          saldo y los movimientos propios de OPS.
        </p>
        {inventory.recentChanges.length === 0 ? (
          <p className="muted">
            Este histórico empieza desde esta versión. Después de los primeros
            cambios de stock aparecerán aquí.
          </p>
        ) : (
          <div className="stack">
            {inventory.recentChanges.map((change, index) => (
              <div
                className="task"
                key={
                  change.variantExternalId +
                  "-" +
                  change.capturedAt.toISOString() +
                  "-" +
                  index
                }
              >
                <div style={{ flex: 1 }}>
                  <strong>{change.itemName}</strong>
                  <div className="muted">
                    {change.capturedAt.toLocaleString("es-MX", {
                      timeZone: "America/Mexico_City",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
                <div
                  className={
                    change.delta < 0 ? "status-warn" : "status-ok"
                  }
                >
                  {number.format(
                    displayQuantity(change.before, change.displayFactor),
                  )}{" "}
                  →{" "}
                  {number.format(
                    displayQuantity(change.after, change.displayFactor),
                  )}{" "}
                  {displayUnit(change.unitLabel, change.displayUnit)}
                  {" · "}
                  {change.delta > 0 ? "+" : ""}
                  {number.format(
                    displayQuantity(change.delta, change.displayFactor),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Inventario completo</h2>
        <p className="muted">
          La existencia principal es el saldo OPS cuando ya fue inicializado.
          Debajo se conserva el stock fuente de Loyverse para reconciliación.
        </p>
        <div className="stack">
          {inventory.smartRows.map((row) => (
            <div className="task" key={row.variantExternalId}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={"/inventory/items/" + row.variantExternalId}>
                  <strong>{row.itemName}</strong>
                </Link>{" "}
                <span
                  className={
                    row.status === "CRITICAL" || row.status === "WATCH"
                      ? "status-warn"
                      : "muted"
                  }
                >
                  {statusLabel(row.status)}
                </span>
                <div className="muted">
                  {row.category}
                  {row.sku ? " · SKU " + row.sku : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>
                  {number.format(displayQuantity(row.inStock, row.displayFactor))} {displayUnit(row.unitLabel, row.displayUnit)}
                </strong>
                <div className="muted">
                  {row.operationalInStock != null
                    ? "OPS · Loyverse " +
                      number.format(
                        displayQuantity(
                          row.sourceInStock,
                          row.displayFactor,
                        ),
                      ) +
                      " " +
                      displayUnit(row.unitLabel, row.displayUnit)
                    : "Fuente Loyverse"}
                </div>
                <div className="muted">
                  consumo/día {number.format(displayQuantity(row.avgDailyUsage14, row.displayFactor))}
                  {" · "}
                  {coverageLabel(row.daysCover)}
                </div>
                <Link href={"/inventory/items/" + row.variantExternalId}>
                  Ver histórico
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={reportShortage} className="card stack">
          <h2>Reportar faltante operativo</h2>
          <p className="muted">
            Deja seguimiento interno; no altera la existencia en Loyverse.
          </p>
          <label>
            Insumo / producto
            <input
              name="itemName"
              placeholder="Ej. Leche deslactosada"
              maxLength={150}
              required
            />
          </label>
          <label>
            Cantidad estimada
            <input
              name="quantityNeeded"
              type="number"
              inputMode="decimal"
              min="0.001"
              step="0.001"
              placeholder="Opcional"
            />
          </label>
          <label>
            Unidad
            <select name="unit" defaultValue="">
              <option value="">Sin especificar</option>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="pz">pz</option>
            </select>
          </label>
          <label>
            Prioridad
            <select name="priority" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
          <label>
            Nota
            <input name="note" maxLength={500} />
          </label>
          <button type="submit">Registrar faltante</button>
        </form>

        <section className="card">
          <h2>Faltantes abiertos · {shortages.length}</h2>
          {shortages.length === 0 ? (
            <p className="status-ok">No hay faltantes abiertos.</p>
          ) : (
            <div className="stack">
              {shortages.map((item) => (
                <div className="task" key={item.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{item.itemName}</strong>{" "}
                    {item.priority === "URGENT" && (
                      <span className="status-warn">URGENTE</span>
                    )}
                    <div className="muted">
                      {item.quantityNeeded
                        ? item.quantityNeeded + " " + (item.unit ?? "")
                        : "Cantidad no especificada"}
                      {item.note ? " · " + item.note : ""}
                    </div>
                  </div>
                  {canResolve && (
                    <form action={resolveShortage}>
                      <input
                        type="hidden"
                        name="shortageId"
                        value={item.id}
                      />
                      <button type="submit">Resolver</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
