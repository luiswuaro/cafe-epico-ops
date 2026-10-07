import Link from "next/link";
import {
  adjustInventoryBalance,
  createInventoryItem,
  reportShortage,
  resolveShortage,
  setOpeningInventoryBalance,
} from "./actions";
import { getInventoryOverview } from "@/src/application/inventory/overview";
import { listActiveInventoryItems } from "@/src/application/inventory/items";
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

function inventoryStatus(
  physical: number | null,
  deviation: number | null,
) {
  if (physical == null || deviation == null) {
    return { label: "SIN CONTEO", className: "muted" };
  }
  if (Math.abs(deviation) < 0.0005) {
    return { label: "CUADRA", className: "status-ok" };
  }
  if (deviation < 0) {
    return { label: "FALTA", className: "status-warn" };
  }
  return { label: "SOBRA", className: "status-warn" };
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedLocationId =
    typeof params.location === "string" ? params.location : undefined;

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

  const [shortages, items, canResolve, canManageItems, canAdjust, overview] =
    await Promise.all([
      listOpenShortages(employee.organizationId, employee.homeStoreId),
      listActiveInventoryItems(employee.organizationId),
      employeeHasPermission(
        employee.id,
        "inventory.shortage.resolve",
        employee.homeStoreId,
      ),
      employeeHasPermission(
        employee.id,
        "inventory.item.manage",
        employee.homeStoreId,
      ),
      employeeHasPermission(
        employee.id,
        "inventory.adjust",
        employee.homeStoreId,
      ),
      getInventoryOverview(
        employee.organizationId,
        employee.homeStoreId,
        requestedLocationId,
      ),
    ]);

  const initializableRows = overview.rows.filter(
    (row) => !row.hasTheoreticalBalance && !row.isLoyverseMapped,
  );
  const adjustableRows = overview.rows.filter(
    (row) => row.hasTheoreticalBalance,
  );
  const adjusted =
    typeof params.adjusted === "string" ? params.adjusted : null;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO OPERATIVO</p>
        <h1>Inventario</h1>
        <p className="muted">
          Teórico = movimientos registrados. Físico = último conteo cerrado.
          La diferencia nunca se corrige sola.
        </p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/inventory/counts" className="button">
            Hacer conteo físico
          </Link>
        </p>
      </section>

      {adjusted != null && (
        <p className="card status-ok">
          Ajuste guardado. Movimiento aplicado: {adjusted}.
        </p>
      )}

      {error === "loyverse-mapped-opening" && (
        <p className="alert">
          Ese insumo está conectado a Loyverse. No uses Inventario inicial;
          sincroniza/importa Loyverse o usa Ajustar saldo teórico si necesitas
          corregir una ubicación.
        </p>
      )}

      {error === "adjustment-invalid" && (
        <p className="alert">
          Ajuste inválido. Revisa cantidad objetivo y escribe una razón.
        </p>
      )}

      {error === "adjustment-target" && (
        <p className="alert">
          No se encontró el insumo o la ubicación seleccionada.
        </p>
      )}

      <section className="card">
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          {overview.locations.map((location) => (
            <Link
              key={location.id}
              href={`/inventory?location=${location.id}`}
              className={
                overview.selectedLocation?.id === location.id
                  ? "button"
                  : undefined
              }
            >
              {location.name}
            </Link>
          ))}
        </div>
      </section>

      {overview.selectedLocation && (
        <section className="grid" style={{ marginTop: "1rem" }}>
          <section className="card">
            <p className="eyebrow">CONTROL · {overview.selectedLocation.name}</p>
            <h2>Teórico vs físico</h2>
            <p className="muted">
              El físico corresponde al último conteo cerrado de esta ubicación.
            </p>

            <div className="stack" style={{ marginTop: "1rem" }}>
              {overview.rows.map((row) => {
                const status = inventoryStatus(row.physical, row.deviation);
                return (
                  <div className="task" key={row.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        <strong>{row.name}</strong>{" "}
                        <span className={status.className}>{status.label}</span>
                      </div>
                      <div className="muted">
                        {row.category} · {row.canonicalUnit}
                      </div>
                      <div style={{ marginTop: ".35rem" }}>
                        Teórico:{" "}
                        <strong>
                          {number.format(row.theoretical)} {row.canonicalUnit}
                        </strong>
                        {" · "}
                        Físico:{" "}
                        <strong>
                          {row.physical == null
                            ? "—"
                            : `${number.format(row.physical)} ${row.canonicalUnit}`}
                        </strong>
                        {" · "}
                        Δ:{" "}
                        <strong>
                          {row.deviation == null
                            ? "—"
                            : `${row.deviation > 0 ? "+" : ""}${number.format(
                                row.deviation,
                              )} ${row.canonicalUnit}`}
                        </strong>
                      </div>
                      <div className="muted">
                        {row.countedAt
                          ? `Último físico: ${row.countedAt.toLocaleString(
                              "es-MX",
                              {
                                timeZone: "America/Mexico_City",
                                dateStyle: "short",
                                timeStyle: "short",
                              },
                            )}`
                          : "Aún no existe conteo físico cerrado"}
                        {row.deviationPct == null
                          ? ""
                          : ` · desviación ${(
                              row.deviationPct * 100
                            ).toFixed(1)}%`}
                      </div>
                      <div style={{ marginTop: ".35rem" }}>
                        <Link href={`/inventory/items/${row.id}`}>
                          Ver histórico y consumo →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {canAdjust && (
            <div className="stack">
              <form action={adjustInventoryBalance} className="card stack">
                <p className="eyebrow">OWNER · CORRECCIÓN</p>
                <h2>Ajustar saldo teórico</h2>
                <p className="muted">
                  Indica cuánto debe quedar realmente en esta ubicación. El
                  sistema calcula el movimiento positivo o negativo y conserva
                  el historial.
                </p>
                <input
                  type="hidden"
                  name="locationId"
                  value={overview.selectedLocation.id}
                />
                <label>
                  Insumo
                  <select name="inventoryItemId" required defaultValue="">
                    <option value="" disabled>
                      Selecciona…
                    </option>
                    {adjustableRows.map((row) => (
                      <option value={row.id} key={row.id}>
                        {row.name} · actual {number.format(row.theoretical)}{" "}
                        {row.canonicalUnit}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Debe quedar en
                  <input
                    name="targetQuantity"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    required
                  />
                </label>
                <label>
                  Razón del ajuste
                  <input
                    name="note"
                    minLength={3}
                    maxLength={500}
                    required
                    placeholder="Ej. Duplicado por saldo inicial manual"
                  />
                </label>
                <button type="submit" disabled={adjustableRows.length === 0}>
                  Guardar corrección
                </button>
              </form>

              <form action={setOpeningInventoryBalance} className="card stack">
              <p className="eyebrow">OWNER · SOLO ARRANQUE</p>
              <h2>Inventario inicial</h2>
              <p className="muted">
                Úsalo una sola vez por insumo y ubicación. Después, el teórico
                cambia únicamente mediante movimientos.
              </p>
              <input
                type="hidden"
                name="locationId"
                value={overview.selectedLocation.id}
              />
              <label>
                Insumo
                <select name="inventoryItemId" required defaultValue="">
                  <option value="" disabled>
                    Selecciona…
                  </option>
                  {initializableRows.map((row) => (
                    <option value={row.id} key={row.id}>
                      {row.name} · {row.canonicalUnit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cantidad física de arranque
                <input
                  name="quantity"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  required
                />
              </label>
              <label>
                Nota
                <input
                  name="note"
                  maxLength={500}
                  placeholder="Ej. Conteo inicial 06/oct"
                />
              </label>
              <button type="submit" disabled={initializableRows.length === 0}>
                Registrar saldo inicial
              </button>
              {initializableRows.length === 0 && (
                <p className="status-ok">
                  No hay insumos sin saldo inicial manual elegibles en esta
                  ubicación.
                </p>
              )}
              <p className="muted">
                Los insumos vinculados a Loyverse no aparecen aquí para evitar
                duplicar existencias.
              </p>
            </form>
            </div>
          )}
        </section>
      )}

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={reportShortage} className="card stack">
          <h2>Reportar faltante</h2>
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
            <input
              name="note"
              maxLength={500}
              placeholder="Proveedor, presentación o detalle opcional"
            />
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
                    <div>
                      <strong>{item.itemName}</strong>{" "}
                      {item.priority === "URGENT" && (
                        <span className="status-warn">URGENTE</span>
                      )}
                    </div>
                    <div className="muted">
                      {item.quantityNeeded
                        ? `${item.quantityNeeded} ${item.unit ?? ""}`
                        : "Cantidad no especificada"}
                      {item.note ? ` · ${item.note}` : ""}
                    </div>
                    <div className="muted">
                      {item.createdAt.toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
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

      <section className="grid" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2>Catálogo interno · {items.length}</h2>
          <p className="muted">
            Son insumos físicos de operación; no son los artículos de venta de
            Loyverse.
          </p>
          <div className="stack">
            {items.map((item) => (
              <div className="task" key={item.id}>
                <div style={{ flex: 1 }}>
                  <strong>{item.name}</strong>
                  <div className="muted">
                    {item.category} · {item.canonicalUnit}
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                    {item.minimumStock
                      ? ` · mínimo ${item.minimumStock} ${item.canonicalUnit}`
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {canManageItems && (
          <form action={createInventoryItem} className="card stack">
            <h2>Agregar insumo</h2>
            <label>
              Nombre
              <input
                name="name"
                maxLength={150}
                placeholder="Ej. Leche deslactosada"
                required
              />
            </label>
            <label>
              SKU interno
              <input name="sku" maxLength={100} placeholder="Opcional" />
            </label>
            <label>
              Categoría
              <input
                name="category"
                maxLength={80}
                placeholder="Ej. LECHE"
                required
              />
            </label>
            <label>
              Unidad canónica
              <select name="canonicalUnit" defaultValue="ml" required>
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="pz">pz</option>
              </select>
            </label>
            <label>
              Stock mínimo
              <input
                name="minimumStock"
                type="number"
                min="0"
                step="0.001"
                placeholder="Opcional"
              />
            </label>
            <button type="submit">Crear insumo</button>
          </form>
        )}
      </section>
    </main>
  );
}
