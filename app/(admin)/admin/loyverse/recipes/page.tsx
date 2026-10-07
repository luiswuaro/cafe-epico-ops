import Link from "next/link";
import { getOperationalRecipeSource } from "@/src/application/loyverse/recipe-book";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

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

export default async function LoyverseRecipesPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("integration.read");
  const data = await getOperationalRecipeSource(organizationId);
  const requestedCategory =
    typeof params.category === "string" ? params.category : null;

  const recipes = requestedCategory
    ? data.recipes.filter((recipe) => recipe.category === requestedCategory)
    : data.recipes;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">LOYVERSE · RECETAS</p>
        <h1>Recetas comerciales</h1>
        <p className="muted">
          Loyverse sigue siendo la fuente maestra, pero Ops consolida las
          presentaciones internas para mostrar una sola receta por bebida o
          alimento. Las únicas categorías operativas son Calientes, Frías y
          Alimentos.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">RECETAS</span>
          <div className="metric">{data.recipes.length}</div>
          <p>recetas operativas únicas.</p>
        </article>
        <article className="card">
          <span className="pill">COMPONENTES DIRECTOS</span>
          <div className="metric">{data.totalDirectComponents}</div>
          <p>líneas exactamente como están armadas en Loyverse.</p>
        </article>
        <article className="card">
          <span className="pill">CONSUMOS EXPANDIDOS</span>
          <div className="metric">{data.totalEffectiveComponents}</div>
          <p>insumos finales después de resolver recetas madre.</p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <p className="eyebrow">FILTRAR POR CATEGORÍA</p>
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          <Link
            href="/admin/loyverse/recipes"
            className={!requestedCategory ? "button" : undefined}
          >
            Todas
          </Link>
          {data.categories.map((category) => (
            <Link
              key={category}
              href={
                "/admin/loyverse/recipes?category=" +
                encodeURIComponent(category)
              }
              className={requestedCategory === category ? "button" : undefined}
            >
              {category}
            </Link>
          ))}
        </div>
      </section>

      <p className="card" style={{ marginTop: "1rem" }}>
        <strong>Cómo leerlo:</strong> “Directo” muestra la receta seleccionada
        para operación. “Consumo real” abre preparaciones base recursivamente
        hasta llegar a los insumos finales. Las presentaciones internas de
        servicio se consolidan y no crean recetas duplicadas.
      </p>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {recipes.map((recipe) => (
          <article className="card" key={recipe.externalId}>
            <p className="eyebrow">
              {recipe.category}
              {recipe.availableForSale ? " · VENTA" : " · INSUMO/BASE"}
            </p>
            <h2>{recipe.itemName}</h2>
            {recipe.sku && <p className="muted">SKU {recipe.sku}</p>}

            <div className="grid" style={{ marginTop: ".8rem" }}>
              <article className="task">
                <div>
                  <strong>Precio</strong>
                  <div className="metric">
                    {recipe.salePrice != null
                      ? money.format(recipe.salePrice)
                      : "—"}
                  </div>
                </div>
              </article>
              <article className="task">
                <div>
                  <strong>COGS Loyverse</strong>
                  <div className="metric">
                    {recipe.loyverseCost != null
                      ? money.format(recipe.loyverseCost)
                      : "—"}
                  </div>
                </div>
              </article>
              <article className="task">
                <div>
                  <strong>Contribución</strong>
                  <div className="metric">
                    {recipe.contribution != null
                      ? money.format(recipe.contribution)
                      : "—"}
                  </div>
                  <div className="muted">
                    {recipe.contributionPct != null
                      ? recipe.contributionPct.toFixed(1) + "%"
                      : "sin precio/costo"}
                  </div>
                </div>
              </article>
              <article className="task">
                <div>
                  <strong>Costo expandido</strong>
                  <div className="metric">
                    {recipe.expandedCost != null
                      ? money.format(recipe.expandedCost)
                      : "—"}
                  </div>
                  <div className="muted">
                    Auditoría desde los insumos hoja.
                  </div>
                </div>
              </article>
            </div>

            {recipe.loyverseCost != null &&
              recipe.expandedCost != null &&
              Math.abs(recipe.loyverseCost - recipe.expandedCost) > 0.02 && (
                <p className="alert" style={{ marginTop: ".8rem" }}>
                  Diferencia de costo: Loyverse{" "}
                  {money.format(recipe.loyverseCost)} vs expansión{" "}
                  {money.format(recipe.expandedCost)}. Conviene revisar costos
                  o componentes.
                </p>
              )}

            <div className="grid" style={{ marginTop: ".8rem" }}>
              <div>
                <h3>Receta directa</h3>
                <div className="stack">
                  {recipe.directComponents.map((component, index) => (
                    <div
                      className="task"
                      key={component.variantExternalId + "-" + index}
                    >
                      <div style={{ flex: 1 }}>
                        <strong>{component.sourceName}</strong>
                        {component.isComposite && (
                          <span className="pill" style={{ marginLeft: ".4rem" }}>
                            RECETA MADRE
                          </span>
                        )}
                        <div className="muted">
                          {number.format(component.quantity)}{" "}
                          {component.unitLabel}
                          {" · "}
                          {component.category}
                          {component.sku ? " · SKU " + component.sku : ""}
                          {component.unitCost != null
                            ? " · costo unit. " +
                              money.format(component.unitCost)
                            : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3>Consumo real expandido</h3>
                <div className="stack">
                  {recipe.effectiveComponents.map((component) => (
                    <div className="task" key={component.variantExternalId}>
                      <div style={{ flex: 1 }}>
                        <strong>{component.sourceName}</strong>
                        <div className="muted">
                          {number.format(component.quantity)}{" "}
                          {component.unitLabel}
                          {" · "}
                          {component.category}
                          {component.sku ? " · SKU " + component.sku : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>

      {recipes.length === 0 && (
        <p className="card muted">
          No hay recetas en esta categoría o todavía falta sincronizar
          artículos/categorías desde Loyverse.
        </p>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/loyverse">← Volver a Loyverse</Link>
      </p>
    </main>
  );
}
