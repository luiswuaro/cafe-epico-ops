import Link from "next/link";
import { notFound } from "next/navigation";
import {
  completeInventoryCount,
  saveInventoryCountLine,
} from "../actions";
import { getInventoryCountDetail } from "@/src/application/inventory/counts";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function InventoryCountDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) notFound();

  await assertEmployeePermission(employee.id, "inventory.count", employee.homeStoreId);

  const detail = await getInventoryCountDetail(
    employee.organizationId,
    employee.homeStoreId,
    id,
  );

  if (!detail) notFound();

  const open = detail.count.status === "OPEN";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CONTEO · {detail.count.locationName}</p>
        <h1>{open ? "Conteo en curso" : "Conteo completado"}</h1>
        <p className="muted">
          {detail.countedItems} / {detail.items.length} insumos registrados.
        </p>
      </section>

      <article className="card">
        {detail.items.length === 0 ? (
          <p className="alert">
            No hay insumos activos en el catálogo. Agrégalos primero desde Inventario.
          </p>
        ) : (
          detail.items.map((item) => {
            const line = item.line;
            const deviation = line ? Number(line.deviationQuantity) : null;

            return (
              <div className="task" key={item.id}>
                <div style={{ flex: 1 }}>
                  <strong>{item.name}</strong>
                  <div className="muted">
                    {item.category} · unidad {item.canonicalUnit} · teórico actual{" "}
                    {item.theoreticalCurrent} {item.canonicalUnit}
                  </div>

                  {line && (
                    <div>
                      <div>
                        Físico: <strong>{line.physicalQuantity} {item.canonicalUnit}</strong>
                      </div>
                      <div className={deviation === 0 ? "status-ok" : "status-warn"}>
                        Desviación: {line.deviationQuantity} {item.canonicalUnit}
                        {" · "}teórico capturado {line.theoreticalQuantitySnapshot}
                      </div>
                    </div>
                  )}

                  {open && (
                    <form action={saveInventoryCountLine} className="stack" style={{ marginTop: ".7rem" }}>
                      <input type="hidden" name="countId" value={detail.count.id} />
                      <input type="hidden" name="inventoryItemId" value={item.id} />
                      <label>
                        Cantidad física ({item.canonicalUnit})
                        <input
                          name="physicalQuantity"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.001"
                          defaultValue={line?.physicalQuantity ?? ""}
                          required
                        />
                      </label>
                      <button type="submit">
                        {line ? "Actualizar conteo" : "Registrar conteo"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })
        )}
      </article>

      {open && detail.countedItems > 0 && (
        <form action={completeInventoryCount} className="card" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="countId" value={detail.count.id} />
          <p>
            Cerrar el conteo conserva las desviaciones y <strong>no</strong> modifica stock teórico.
          </p>
          <button type="submit">Cerrar conteo</button>
        </form>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/inventory/counts">← Conteos</Link>
      </p>
    </main>
  );
}
