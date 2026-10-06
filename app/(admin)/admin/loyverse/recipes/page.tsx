import Link from "next/link";
import { getLoyverseRecipeSource } from "@/src/application/loyverse/recipes";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

export default async function LoyverseRecipesPage() {
  const { organizationId } = await requirePermission("integration.read");
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    return (
      <main className="shell">
        <p className="alert">Empleado sin sucursal asignada.</p>
      </main>
    );
  }

  const data = await getLoyverseRecipeSource(
    organizationId,
    employee.homeStoreId,
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · LOYVERSE · RECETAS FUENTE</p>
        <h1>Composiciones tal como están en Loyverse</h1>
        <p className="muted">
          Esta vista lee artículos compuestos directamente del espejo de
          Loyverse. Sirve para auditar cantidades y compararlas contra la
          receta técnica de Café Épico; no publica ni reemplaza recetas
          técnicas automáticamente.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">COMPUESTOS</span>
          <div className="metric">{data.recipes.length}</div>
          <p>recetas/composiciones detectadas en Loyverse.</p>
        </article>
        <article className="card">
          <span className="pill">COMPONENTES</span>
          <div className="metric">{data.totalComponents}</div>
          <p>líneas de composición leídas.</p>
        </article>
        <article className="card">
          <span className="pill">MAPEADOS</span>
          <div className="metric">{data.mappedComponents}</div>
          <p>
            componentes ya convertibles a g, ml o pz de Café Épico Ops.
          </p>
        </article>
      </section>

      <p className="card" style={{ marginTop: "1rem" }}>
        Para que una cantidad de Loyverse se convierta a la unidad interna,
        primero vincula su insumo en{" "}
        <Link href="/admin/loyverse/inventory">
          Mapeo de inventario Loyverse
        </Link>
        .
      </p>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {data.recipes.map((recipe) => (
          <article className="card" key={recipe.externalId}>
            <h2>{recipe.itemName}</h2>
            <p className="muted">
              {recipe.mappedComponents} / {recipe.components.length} componentes
              con conversión interna.
            </p>

            <div className="stack">
              {recipe.components.map((component, index) => (
                <div
                  className="task"
                  key={`${component.variantExternalId}-${index}`}
                >
                  <div style={{ flex: 1 }}>
                    <strong>{component.sourceName}</strong>
                    <div className="muted">
                      Loyverse: {number.format(component.quantity)}
                      {component.sourceUnit
                        ? ` ${component.sourceUnit}`
                        : " unidades fuente"}
                    </div>
                    {component.mapped ? (
                      <div className="status-ok">
                        → {component.inventoryItemName}:{" "}
                        {number.format(component.canonicalQuantity ?? 0)}{" "}
                        {component.canonicalUnit}
                      </div>
                    ) : (
                      <div className="status-warn">
                        Sin mapeo · todavía no puede convertirse
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/loyverse">← Volver a Loyverse</Link>
      </p>
    </main>
  );
}
