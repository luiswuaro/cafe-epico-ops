import Link from "next/link";
import { getEmployeeRecipeBook } from "@/src/application/loyverse/recipe-book";
import {
  isOperationalRecipeCategory,
  OPERATIONAL_RECIPE_CATEGORIES,
} from "@/src/domain/recipes/operational";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();
  const recipes = await getEmployeeRecipeBook(employee.organizationId);

  const query =
    typeof params.q === "string" ? normalize(params.q) : "";
  const requestedCategory =
    typeof params.category === "string" ? params.category : "";
  const category = isOperationalRecipeCategory(requestedCategory)
    ? requestedCategory
    : "";

  const visible = recipes.filter((recipe) => {
    const matchesQuery =
      !query ||
      normalize(recipe.name).includes(query) ||
      normalize(recipe.category).includes(query);
    const matchesCategory =
      !category || recipe.category === category;
    return matchesQuery && matchesCategory;
  });

  const categoryCount = (
    row: (typeof OPERATIONAL_RECIPE_CATEGORIES)[number],
  ) => recipes.filter((recipe) => recipe.category === row).length;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">RECETARIO DE BARRA</p>
        <h1>Recetas</h1>
        <p className="muted">
          Una receta operativa por bebida o alimento. El recetario solo usa
          tres categorías: Calientes, Frías y Alimentos.
        </p>
      </section>

      <form className="card stack recipe-filters" method="get">
        {category && (
          <input type="hidden" name="category" value={category} />
        )}
        <label>
          Buscar
          <input
            name="q"
            defaultValue={
              typeof params.q === "string" ? params.q : ""
            }
            placeholder="Latte, moka, matcha, croissant..."
          />
        </label>

        <div className="recipe-category-tabs" aria-label="Categorías de recetas">
          <Link
            href={
              query
                ? "/recipes?q=" + encodeURIComponent(
                    typeof params.q === "string" ? params.q : "",
                  )
                : "/recipes"
            }
            className={!category ? "active" : undefined}
          >
            Todas
            <span>{recipes.length}</span>
          </Link>

          {OPERATIONAL_RECIPE_CATEGORIES.map((row) => {
            const href =
              "/recipes?category=" +
              encodeURIComponent(row) +
              (typeof params.q === "string" && params.q.trim()
                ? "&q=" + encodeURIComponent(params.q)
                : "");

            return (
              <Link
                key={row}
                href={href}
                className={category === row ? "active" : undefined}
              >
                {row === "FRÍAS"
                  ? "Frías"
                  : row === "CALIENTES"
                    ? "Calientes"
                    : "Alimentos"}
                <span>{categoryCount(row)}</span>
              </Link>
            );
          })}
        </div>

        <div className="recipe-filter-actions">
          <button type="submit">Buscar</button>
          {(query || category) && (
            <Link className="button" href="/recipes">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <div className="recipe-book">
        {OPERATIONAL_RECIPE_CATEGORIES.map((categoryName) => {
          const rows = visible.filter(
            (recipe) => recipe.category === categoryName,
          );
          if (rows.length === 0) return null;

          return (
            <section className="recipe-section" key={categoryName}>
              <div className="recipe-section-heading">
                <div>
                  <p className="eyebrow">CATEGORÍA</p>
                  <h2>
                    {categoryName === "FRÍAS"
                      ? "Frías"
                      : categoryName === "CALIENTES"
                        ? "Calientes"
                        : "Alimentos"}
                  </h2>
                </div>
                <span className="pill">{rows.length} receta(s)</span>
              </div>

              <div className="grid recipe-grid">
                {rows.map((recipe) => (
                  <article className="card recipe-card" key={recipe.id}>
                    <h3>{recipe.name}</h3>
                    <p className="muted">
                      {recipe.components.length} componente(s) de operación
                    </p>
                    <Link href={"/recipes/" + recipe.id} className="button">
                      Ver receta
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {visible.length === 0 && (
        <p className="card muted" style={{ marginTop: "1rem" }}>
          No encontré recetas con ese filtro.
        </p>
      )}
    </main>
  );
}
