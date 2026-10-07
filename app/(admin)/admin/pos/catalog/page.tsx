import {
  createManualPosProduct,
  savePosRecipe,
  togglePosCatalogItem,
} from "./actions";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function recipeText(
  components: Array<{
    name: string;
    quantity: number;
    unitLabel: string;
  }>,
) {
  return components
    .map(
      (component) =>
        component.quantity +
        " " +
        component.unitLabel +
        " | " +
        component.name,
    )
    .join("\n");
}

export default async function PosCatalogAdminPage() {
  const { organizationId } = await requirePermission("pos.catalog.manage");
  const catalog = await getPosCatalog(organizationId, {
    includeDisabled: true,
  });

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">POS · ADMINISTRACIÓN</p>
        <h1>Catálogo y recetas</h1>
        <p className="muted">
          Decide qué aparece en caja. Puedes ocultar productos de Loyverse,
          agregar productos propios y corregir la receta operativa que OPS
          usará después para inventario.
        </p>
      </section>

      <details className="card pos-admin-create">
        <summary>+ Agregar producto nuevo</summary>
        <form action={createManualPosProduct} className="stack">
          <div className="form-grid">
            <label>
              Nombre
              <input name="name" required />
            </label>
            <label>
              Categoría
              <select name="category" defaultValue="ALIMENTOS">
                <option value="CALIENTES">Calientes</option>
                <option value="FRÍAS">Frías</option>
                <option value="ALIMENTOS">Alimentos</option>
              </select>
            </label>
            <label>
              Precio
              <input
                name="price"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
            </label>
          </div>
          <label>
            Receta aquí
            <textarea
              name="dineInRecipe"
              rows={5}
              placeholder={"18 g | Café en grano\n220 ml | Leche"}
            />
          </label>
          <label>
            Receta para llevar
            <textarea
              name="takeawayRecipe"
              rows={5}
              placeholder="Déjala vacía para usar la misma receta."
            />
          </label>
          <p className="muted">
            Formato por línea: <strong>cantidad unidad | ingrediente</strong>.
          </p>
          <button type="submit">Crear producto</button>
        </form>
      </details>

      <section className="pos-admin-list">
        {catalog.map((item) => (
          <article className="card pos-admin-item" key={item.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {item.category} · {item.sourceType}
                </p>
                <h2>{item.name}</h2>
                <p className="muted">
                  {money.format(item.price)} · {item.popularity30d} venta(s)
                  en 30 días ·{" "}
                  {item.serviceRecipes.DINE_IN.configured
                    ? "receta configurada"
                    : "SIN RECETA"}
                </p>
              </div>
              <form action={togglePosCatalogItem}>
                <input type="hidden" name="catalogId" value={item.id} />
                <input
                  type="hidden"
                  name="enabled"
                  value={item.active ? "false" : "true"}
                />
                <button type="submit">
                  {item.active ? "Quitar del POS" : "Volver a mostrar"}
                </button>
              </form>
            </div>

            <details className="pos-recipe-editor">
              <summary>Editar receta</summary>
              <form action={savePosRecipe} className="stack">
                <input type="hidden" name="catalogId" value={item.id} />
                <label>
                  Aquí
                  <textarea
                    name="dineInRecipe"
                    rows={5}
                    defaultValue={recipeText(
                      item.serviceRecipes.DINE_IN.components,
                    )}
                  />
                </label>
                <label>
                  Para llevar
                  <textarea
                    name="takeawayRecipe"
                    rows={5}
                    defaultValue={recipeText(
                      item.serviceRecipes.TAKEAWAY.components,
                    )}
                  />
                </label>
                <p className="muted">
                  Formato: 18 g | Café en grano. En modo espejo esto calcula
                  consumo esperado; todavía no descuenta inventario.
                </p>
                <button type="submit">Guardar receta</button>
              </form>
            </details>
          </article>
        ))}
      </section>
    </main>
  );
}
