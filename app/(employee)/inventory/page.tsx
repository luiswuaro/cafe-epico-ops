import Link from "next/link";
import { refreshLoyverseInventorySource } from "./loyverse-actions";
import { reportShortage, resolveShortage } from "./actions";
import { getLoyverseInventoryView } from "@/src/application/loyverse/inventory-view";
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
  maximumFractionDigits: 2,
});

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
    getLoyverseInventoryView(employee.organizationId, requestedStore),
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

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · FUENTE LOYVERSE</p>
        <h1>Inventario</h1>
        <p className="muted">
          La existencia que ves aquí viene directamente del POS. Para cambiar
          cantidades, costos o artículos se usa Loyverse; Café Épico Ops solo
          los refleja y analiza.
        </p>
      </section>

      {refreshed && (
        <p className="card status-ok">
          Loyverse actualizado · {String(params.items ?? "0")} artículos ·{" "}
          {String(params.levels ?? "0")} niveles de inventario.
        </p>
      )}

      {error && <p className="alert">No se pudo actualizar: {error}</p>}

      <section className="grid">
        <article className="card">
          <span className="pill">FUENTE MAESTRA</span>
          <div className="metric">Loyverse</div>
          <p>
            {inventory.rows.length} artículos con control de stock en{" "}
            <strong>{inventory.selectedStore?.name ?? "sin tienda"}</strong>.
          </p>
        </article>

        <article className="card">
          <span className="pill">ÚLTIMA LECTURA</span>
          <div className="metric">
            {inventory.lastSyncedAt
              ? inventory.lastSyncedAt.toLocaleTimeString("es-MX", {
                  timeZone: "America/Mexico_City",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
          <p className="muted">
            {inventory.lastSyncedAt
              ? inventory.lastSyncedAt.toLocaleDateString("es-MX", {
                  timeZone: "America/Mexico_City",
                })
              : "Todavía no hay una sincronización de inventario."}
          </p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
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
              <button type="submit">Actualizar desde Loyverse ahora</button>
            </form>
          )}
        </div>
        <p className="muted" style={{ marginTop: ".6rem" }}>
          Ya no se usa “inventario inicial”, mapeo ni ajustes de existencia en
          Ops. Si corriges una cantidad en Loyverse, pulsa actualizar y aquí se
          refleja.
        </p>
      </section>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {[...groups.entries()].map(([category, rows]) => (
          <article className="card" key={category}>
            <p className="eyebrow">{category}</p>
            <div className="stack">
              {rows.map((row) => (
                <div className="task" key={row.variantExternalId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <strong>{row.itemName}</strong>{" "}
                      {row.low && (
                        <span className="status-warn">STOCK BAJO</span>
                      )}
                    </div>
                    <div className="muted">
                      {row.sku ? "SKU " + row.sku + " · " : ""}
                      {row.soldByWeight
                        ? "Loyverse: peso/volumen"
                        : "Loyverse: pieza"}
                    </div>
                    <div style={{ marginTop: ".35rem" }}>
                      Existencia:{" "}
                      <strong>
                        {number.format(row.inStock)} {row.unitLabel}
                      </strong>
                      {row.lowStock != null
                        ? " · mínimo " + number.format(row.lowStock)
                        : ""}
                      {row.optimalStock != null
                        ? " · óptimo " + number.format(row.optimalStock)
                        : ""}
                    </div>
                    {row.purchaseCost != null && (
                      <div className="muted">
                        Costo registrado: {money.format(row.purchaseCost)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={reportShortage} className="card stack">
          <h2>Reportar faltante operativo</h2>
          <p className="muted">
            Esto deja una nota interna para seguimiento; no modifica la
            existencia de Loyverse.
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
