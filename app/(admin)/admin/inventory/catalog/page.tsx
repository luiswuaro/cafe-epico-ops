import Link from "next/link";
import {
  toggleInventoryItem,
  updateInventoryItem,
} from "./actions";
import { getInventoryCatalogAdmin } from "@/src/application/inventory/catalog-admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errors: Record<string, string> = {
  invalid: "Datos inválidos.",
  "not-found": "No se encontró el insumo.",
  minimum: "El stock mínimo no puede ser negativo.",
  "duplicate-sku": "Ese SKU ya está usado por otro insumo.",
  "unit-in-use":
    "No se cambió la unidad: el insumo ya tiene historia o dependencias. Crea un insumo nuevo o realiza una migración controlada.",
};

export default async function InventoryCatalogAdminPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { organizationId } =
    await requirePermission("inventory.item.manage");
  const items = await getInventoryCatalogAdmin(organizationId);
  const error =
    typeof params.error === "string" ? params.error : null;
  const item =
    typeof params.item === "string" ? params.item : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · CATÁLOGO DE INVENTARIO</p>
        <h1>Editar insumos y unidades</h1>
        <p className="muted">
          Puedes editar nombre, SKU, categoría, unidad y stock mínimo. Un
          cambio de unidad solo se permite cuando el insumo todavía no tiene
          cantidades históricas o dependencias.
        </p>
      </section>

      {params.updated === "1" && (
        <p className="card status-ok">Insumo actualizado.</p>
      )}
      {error && (
        <p className="alert">
          {errors[error] ?? "No se pudo guardar."}
          {item ? ` · ${item}` : ""}
        </p>
      )}

      <section className="stack">
        {items.map((row) => (
          <article className="card" key={row.id}>
            <form action={updateInventoryItem} className="stack">
              <input type="hidden" name="itemId" value={row.id} />
              <div className="grid">
                <label>
                  Nombre
                  <input name="name" defaultValue={row.name} required />
                </label>
                <label>
                  SKU
                  <input name="sku" defaultValue={row.sku ?? ""} />
                </label>
                <label>
                  Categoría
                  <input
                    name="category"
                    defaultValue={row.category}
                    required
                  />
                </label>
                <label>
                  Unidad
                  <select
                    name="canonicalUnit"
                    defaultValue={row.canonicalUnit}
                  >
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
                    defaultValue={row.minimumStock ?? ""}
                  />
                </label>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: ".5rem",
                  flexWrap: "wrap",
                }}
              >
                <button type="submit">Guardar cambios</button>
              </div>
            </form>

            <form
              action={toggleInventoryItem}
              style={{ marginTop: ".7rem" }}
            >
              <input type="hidden" name="itemId" value={row.id} />
              <input
                type="hidden"
                name="active"
                value={String(!row.isActive)}
              />
              <button type="submit">
                {row.isActive ? "Desactivar insumo" : "Reactivar insumo"}
              </button>
              <span
                className={row.isActive ? "status-ok" : "status-warn"}
                style={{ marginLeft: ".7rem" }}
              >
                {row.isActive ? "Activo" : "Inactivo"}
              </span>
            </form>
          </article>
        ))}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/inventory">Crear insumo nuevo →</Link>
      </p>
      <p>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
