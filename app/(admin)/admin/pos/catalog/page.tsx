import {
  createManualPosProduct,
  savePosRecipe,
  togglePosCatalogItem,
  updatePosCatalogPrice,
} from "./actions";
import { RecipeServiceEditor } from "./recipe-editor";
import { SearchableCollection } from "@/components/searchable-collection";
import { getPosCatalog } from "@/src/application/pos/catalog";
import {getNativeRecipeOptions} from "@/src/application/pos/native-recipe-options";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export default async function PosCatalogAdminPage({searchParams}:{
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const params=await searchParams;
  const priceSaved=typeof params.priceSaved==="string"?params.priceSaved:null;
  const { organizationId } = await requirePermission("pos.catalog.manage");
  const catalog = await getPosCatalog(organizationId, {
    includeDisabled: true,
  });
  const {employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Configura una sucursal para editar recetas OPS.");
  const native=await getNativeRecipeOptions(organizationId,employee.homeStoreId);

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
        <p className="muted">Nuevo: vincula las recetas directamente con los insumos y ubicaciones reales de Inventario OPS; sin equivalencias obligatorias de Loyverse.</p>
        <p className="muted">
          Un producto, una ficha. La receta se edita por insumos y sólo
          personalizas “Para llevar” cuando realmente cambia el consumo.
        </p>
      </section>

      {priceSaved && <section className="card" role="status">
        <p className="status-ok">Precio actualizado en OPS. Los tickets existentes mantienen su valor guardado.</p>
      </section>}

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
                  inventoryOptions={native.options}
                  legacyMappings={native.legacyMappings}
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
              <summary>Editar precio de venta</summary>
              <form action={updatePosCatalogPrice} className="stack pos-price-edit">
                <input type="hidden" name="catalogId" value={item.id}/>
                <label>
                  Precio en OPS (MXN)
                  <input type="number" name="price" defaultValue={item.price.toFixed(2)}
                    min="0.01" max="100000" step="0.01" required/>
                </label>
                <p className="muted">
                  {item.sourceType==="LOYVERSE"
                    ?"Precio independiente de Loyverse; sólo aplica al POS de OPS."
                    :"Precio de producto creado en OPS."}
                  {" "}Los tickets guardados conservan su precio original.
                </p>
                <button type="submit">Guardar precio</button>
              </form>
            </details>
            <details className="pos-recipe-editor">
              <summary>Editar receta</summary>
              <form action={savePosRecipe} className="stack">
                <input type="hidden" name="catalogId" value={item.id} />

                <RecipeServiceEditor
                  dineIn={item.serviceRecipes.DINE_IN.components}
                  takeaway={item.serviceRecipes.TAKEAWAY.components}
                  ingredientOptions={ingredientOptions}
                  inventoryOptions={native.options}
                  legacyMappings={native.legacyMappings}
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
