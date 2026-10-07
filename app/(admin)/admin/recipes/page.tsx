import Link from "next/link";
import { createRecipe, createRecipeDraft } from "./actions";
import { listRecipesForAdmin } from "@/src/application/recipes/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminRecipesPage() {
  const { organizationId } = await requirePermission("recipe.manage");
  const recipes = await listRecipesForAdmin(organizationId);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · RECETAS</p>
        <h1>Editor versionado</h1>
        <p className="muted">
          Una receta publicada no se modifica en sitio. Crea un borrador,
          cambia componentes y publica una nueva versión.
        </p>
      </section>

      <section className="grid">
        <form action={createRecipe} className="card stack">
          <h2>Nueva receta</h2>
          <label>
            Nombre
            <input
              name="name"
              required
              maxLength={150}
              placeholder="Ej. Espresso tónico naranja"
            />
          </label>
          <button type="submit">Crear borrador</button>
        </form>

        <article className="card">
          <h2>Recetas · {recipes.length}</h2>
          <p className="muted">
            El colaborador solo ve la versión ACTIVE.
          </p>
        </article>
      </section>

      <section className="stack" style={{ marginTop: "1rem" }}>
        {recipes.map((recipe) => (
          <article className="card" key={recipe.id}>
            <h2>{recipe.name}</h2>
            <p className="muted">
              Activa:{" "}
              {recipe.currentVersionId
                ? `v${recipe.majorVersion}.${recipe.minorVersion}`
                : "sin publicar"}
              {recipe.draft
                ? ` · borrador v${recipe.draft.majorVersion}.${recipe.draft.minorVersion}`
                : ""}
            </p>
            <div
              style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}
            >
              <Link
                href={
                  recipe.draft
                    ? `/admin/recipes/${recipe.id}?version=${recipe.draft.id}`
                    : `/admin/recipes/${recipe.id}`
                }
                className="button"
              >
                {recipe.draft ? "Editar borrador" : "Ver receta"}
              </Link>
              {!recipe.draft && recipe.currentVersionId && (
                <form action={createRecipeDraft}>
                  <input
                    type="hidden"
                    name="recipeId"
                    value={recipe.id}
                  />
                  <button type="submit">Crear nueva versión</button>
                </form>
              )}
            </div>
          </article>
        ))}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
