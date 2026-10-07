import Link from "next/link";
import { getEmployeeRecipeBook } from "@/src/application/loyverse/recipe-book";
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
  const category =
    typeof params.category === "string" ? params.category : "";

  const categories = Array.from(
    new Set(recipes.map((recipe) => recipe.category)),
  ).sort((a, b) => a.localeCompare(b, "es"));

  const visible = recipes.filter((recipe) => {
    const matchesQuery =
      !query ||
      normalize(recipe.name).includes(query) ||
      normalize(recipe.category).includes(query);
    const matchesCategory =
      !category || recipe.category === category;
    return matchesQuery && matchesCategory;
  });

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

      <form className="card stack" method="get">
        <div className="grid">
          <label>
            Buscar bebida
            <input
              name="q"
              defaultValue={
                typeof params.q === "string" ? params.q : ""
              }
              placeholder="Latte, moka, matcha..."
              autoFocus
            />
          </label>
          <label>
            Categoría
            <select name="category" defaultValue={category}>
              <option value="">Todas</option>
              {categories.map((row) => (
                <option key={row} value={row}>
                  {row}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          style={{
            display: "flex",
            gap: ".6rem",
            flexWrap: "wrap",
          }}
        >
          <button type="submit">Buscar</button>
          {(query || category) && (
            <Link className="button" href="/recipes">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <section className="grid" style={{ marginTop: "1rem" }}>
        {visible.map((recipe) => (
          <article className="card" key={recipe.id}>
            <p className="eyebrow">{recipe.category}</p>
            <h2>{recipe.name}</h2>
            <p className="muted">
              {recipe.components.length} componentes de barra
            </p>
            <Link href={"/recipes/" + recipe.id}>
              <button>Ver receta</button>
            </Link>
          </article>
        ))}
      </section>

      {visible.length === 0 && (
        <p className="card muted" style={{ marginTop: "1rem" }}>
          No encontré recetas con ese filtro.
        </p>
      )}
    </main>
  );
}
