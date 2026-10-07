import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployeeRecipe } from "@/src/application/loyverse/recipe-book";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 1,
});

export default async function RecipeDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { employee } = await getCurrentEmployee();
  const recipe = await getEmployeeRecipe(employee.organizationId, id);
  if (!recipe) notFound();

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">RECETA · {recipe.category}</p>
        <h1>{recipe.name}</h1>
        <p className="muted">
          Receta operativa sin empaque. Si un componente es una receta madre,
          se muestra como una unidad de esa preparación.
        </p>
      </section>

      <section className="card">
        <div className="stack">
          {recipe.components.map((component) => (
            <div className="task" key={component.variantExternalId}>
              <div style={{ flex: 1 }}>
                <strong>{component.sourceName}</strong>
                {component.isComposite && (
                  <span className="pill" style={{ marginLeft: ".5rem" }}>
                    RECETA MADRE
                  </span>
                )}
              </div>
              <div className="metric" style={{ fontSize: "1.4rem" }}>
                {number.format(component.displayQuantity)}{" "}
                {component.displayUnit}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/recipes">← Volver al recetario</Link>
      </p>
    </main>
  );
}
