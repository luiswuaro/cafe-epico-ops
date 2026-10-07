import Link from "next/link";
import { getEmployeeRecipeBook } from "@/src/application/loyverse/recipe-book";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const { employee } = await getCurrentEmployee();
  const recipes = await getEmployeeRecipeBook(employee.organizationId);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">RECETARIO DE BARRA</p>
        <h1>Recetas básicas</h1>
        <p className="muted">
          Una sola receta por bebida. Se prioriza la versión “AQUI” y se
          ocultan vasos, tapas, popotes, mangas y otros desechables.
        </p>
      </section>

      <section className="grid">
        {recipes.map((recipe) => (
          <article className="card" key={recipe.id}>
            <p className="eyebrow">{recipe.category}</p>
            <h2>{recipe.name}</h2>
            <p className="muted">
              {recipe.components.length} componentes de barra
            </p>
            <Link href={`/recipes/${recipe.id}`}>
              <button>Ver receta</button>
            </Link>
          </article>
        ))}
      </section>

      {recipes.length === 0 && (
        <p className="card muted">
          No hay recetas comerciales sincronizadas todavía.
        </p>
      )}
    </main>
  );
}
