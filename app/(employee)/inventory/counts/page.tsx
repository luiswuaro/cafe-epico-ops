import Link from "next/link";
import { startInventoryCount } from "./actions";
import {
  listInventoryLocations,
  listRecentInventoryCounts,
} from "@/src/application/inventory/counts";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function InventoryCountsPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    return <main className="shell"><p className="alert">Empleado sin sucursal asignada.</p></main>;
  }

  await assertEmployeePermission(employee.id, "inventory.count", employee.homeStoreId);

  const [locations, recent] = await Promise.all([
    listInventoryLocations(employee.organizationId, employee.homeStoreId),
    listRecentInventoryCounts(employee.organizationId, employee.homeStoreId),
  ]);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">INVENTARIO · CONTEO FÍSICO</p>
        <h1>Conteos por ubicación</h1>
        <p className="muted">
          El conteo registra desviaciones. No ajusta el stock teórico automáticamente.
        </p>
      </section>

      <section className="grid">
        <form action={startInventoryCount} className="card stack">
          <h2>Iniciar conteo</h2>
          <label>
            Ubicación
            <select name="locationId" defaultValue="" required>
              <option value="" disabled>Selecciona ubicación</option>
              {locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Iniciar / continuar conteo</button>
        </form>

        <section className="card">
          <h2>Conteos recientes</h2>
          {recent.length === 0 ? (
            <p className="muted">Todavía no hay conteos.</p>
          ) : (
            <div className="stack">
              {recent.map((count) => (
                <div className="task" key={count.id}>
                  <div style={{ flex: 1 }}>
                    <strong>{count.locationName}</strong>
                    <div className="muted">
                      {count.status} ·{" "}
                      {count.startedAt.toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                  <Link href={`/inventory/counts/${count.id}`}>
                    {count.status === "OPEN" ? "Continuar →" : "Ver →"}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/inventory">← Volver a inventario</Link>
      </p>
    </main>
  );
}
