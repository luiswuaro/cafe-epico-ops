import {
  createManualPosProduct,
  savePosRecipe,
  togglePosCatalogItem,
} from "./actions";
import { RecipeServiceEditor } from "./recipe-editor";
import { SearchableCollection } from "@/components/searchable-collection";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export default async function PosCatalogAdminPage() {
  const { organizationId } = await requirePermission("pos.catalog.manage");
  const catalog = await getPosCatalog(organizationId, {
    includeDisabled: true,
  });

  const ingredientOptions = Array.from(
    new Set(
      catalog.flatMap((item) => [
        ...item.serviceRecipes.DINE_IN.components.map((row) => row.name),
        ...item.serviceRecipes.TAKEAWAY.components.map((row) => row.name),
      ]),
    ),
  ).sort((a, b) => a.localeCompare(b, "es-MX"));

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">POS · ADMINISTRACIÓN</p>
        <h1>Catálogo y recetas</h1>
        <p className="muted">
          Un producto, una ficha. La receta se edita por insumos y sólo
          personalizas “Para llevar” cuando realmente cambia el consumo.
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

          <RecipeServiceEditor
            dineIn={[]}
            takeaway={[]}
            ingredientOptions={ingredientOptions}
          />

          <button type="submit">Crear producto</button>
        </form>
      </details>

      <SearchableCollection
        label="bebidas y productos"
        placeholder="Ej. maracuyá, latte, moka, jarabe, hielo..."
        listClassName="pos-admin-list"
        entries={catalog.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          status: item.active ? "ACTIVO" : "OCULTO",
          searchText: [
            item.sourceType,
            ...item.serviceRecipes.DINE_IN.components.map(c=>c.name),
            ...item.serviceRecipes.TAKEAWAY.components.map(c=>c.name),
          ].join(" "),
          content: (
            <article className="card pos-admin-item">
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

                <RecipeServiceEditor
                  dineIn={item.serviceRecipes.DINE_IN.components}
                  takeaway={item.serviceRecipes.TAKEAWAY.components}
                  ingredientOptions={ingredientOptions}
                />

                <p className="muted">
                  Cada renglón es un insumo. OPS conserva la trazabilidad de
                  cantidad, unidad e ingrediente sin obligarte a escribir
                  fórmulas de texto.
                </p>
                <button type="submit">Guardar receta</button>
              </form>
            </details>
            </article>
          ),
        }))}
      />
    </main>
  );
}
