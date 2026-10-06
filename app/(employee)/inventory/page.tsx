import { reportShortage, resolveShortage } from "./actions";
import { listOpenShortages } from "@/src/application/inventory/shortages";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    return <main className="shell"><p className="alert">Empleado sin sucursal asignada.</p></main>;
  }

  await assertEmployeePermission(employee.id, "inventory.read", employee.homeStoreId);

  const [shortages, canResolve] = await Promise.all([
    listOpenShortages(employee.organizationId, employee.homeStoreId),
    employeeHasPermission(
      employee.id,
      "inventory.shortage.resolve",
      employee.homeStoreId,
    ),
  ]);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO OPERATIVO</p>
        <h1>Faltantes</h1>
        <p className="muted">
          Reportar un faltante no modifica stock. Solo crea una obligación operativa trazable.
        </p>
      </section>

      <section className="grid">
        <form action={reportShortage} className="card stack">
          <h2>Reportar faltante</h2>
          <label>
            Insumo / producto
            <input name="itemName" placeholder="Ej. Leche deslactosada" maxLength={150} required />
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
            <input name="note" maxLength={500} placeholder="Proveedor, presentación o detalle opcional" />
          </label>

          <button type="submit">Registrar faltante</button>
        </form>

        <section className="card">
          <h2>Abiertos · {shortages.length}</h2>
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
                      <input type="hidden" name="shortageId" value={item.id} />
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
