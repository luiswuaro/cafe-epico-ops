import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addRecipeComponent,
  createRecipeDraft,
  publishRecipeDraft,
  removeRecipeComponent,
  updateRecipeComponent,
  updateRecipeDraft,
} from "../actions";
import { getRecipeAdminDetail } from "@/src/application/recipes/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminRecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requestedVersion =
    typeof query.version === "string" ? query.version : undefined;
  const { organizationId } = await requirePermission("recipe.manage");
  const data = await getRecipeAdminDetail(
    organizationId,
    id,
    requestedVersion,
  );

  if (!data || !data.selected) notFound();

  const editable = data.selected.status === "DRAFT";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">
          RECETA · v{data.selected.majorVersion}.
          {data.selected.minorVersion} · {data.selected.status}
        </p>
        <h1>{data.recipe.name}</h1>
        <p className="muted">
          {editable
            ? "Este borrador se puede modificar."
            : "Esta versión es histórica/activa y permanece inmutable."}
        </p>
      </section>

      {!editable && (
        <section className="card">
          <form action={createRecipeDraft}>
            <input type="hidden" name="recipeId" value={data.recipe.id} />
            <button type="submit">Crear nueva versión editable</button>
          </form>
        </section>
      )}

      {editable && (
        <section className="grid">
          <form action={updateRecipeDraft} className="card stack">
            <h2>Datos de la versión</h2>
            <input type="hidden" name="recipeId" value={data.recipe.id} />
            <input
              type="hidden"
              name="versionId"
              value={data.selected.id}
            />
            <label>
              Rendimiento
              <input
                name="yieldQuantity"
                type="number"
                step="0.001"
                min="0"
                defaultValue={data.selected.yieldQuantity ?? ""}
              />
            </label>
            <label>
              Unidad de rendimiento
              <select
                name="yieldUnit"
                defaultValue={data.selected.yieldUnit ?? ""}
              >
                <option value="">Sin definir</option>
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="pz">pz</option>
              </select>
            </label>
            <label>
              Procedimiento
              <textarea
                name="instructions"
                rows={8}
                defaultValue={data.selected.instructions}
              />
            </label>
            <label>
              Quality spec · JSON
              <textarea
                name="qualitySpec"
                rows={8}
                defaultValue={JSON.stringify(
                  data.selected.qualitySpec,
                  null,
                  2,
                )}
              />
            </label>
            <button type="submit">Guardar versión</button>
          </form>

          <form action={addRecipeComponent} className="card stack">
            <h2>Agregar componente</h2>
            <input type="hidden" name="recipeId" value={data.recipe.id} />
            <input
              type="hidden"
              name="versionId"
              value={data.selected.id}
            />
            <label>
              Insumo
              <select name="inventoryItemId" required defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                {data.inventoryItems.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · {item.unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad
              <input
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </label>
            <label>
              Merma %
              <input
                name="wastePercent"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue="0"
              />
            </label>
            <label>
              Orden
              <input
                name="sequence"
                type="number"
                min="0"
                defaultValue="100"
              />
            </label>
            <label>
              Nota
              <input name="notes" maxLength={500} />
            </label>
            <button type="submit">Agregar componente</button>
          </form>
        </section>
      )}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Componentes · {data.components.length}</h2>
        {data.components.length === 0 ? (
          <p className="muted">La receta todavía no tiene componentes.</p>
        ) : (
          <div className="stack">
            {data.components.map((component) => (
              <div className="task" key={component.id}>
                <div style={{ flex: 1 }}>
                  <strong>{component.itemName}</strong>
                  {!editable ? (
                    <div className="muted">
                      {component.quantity} {component.unit}
                      {Number(component.wasteFactor) > 0
                        ? ` + ${(
                            Number(component.wasteFactor) * 100
                          ).toFixed(1)}% merma`
                        : ""}
                    </div>
                  ) : (
                    <form
                      action={updateRecipeComponent}
                      className="stack"
                      style={{ marginTop: ".5rem" }}
                    >
                      <input
                        type="hidden"
                        name="componentId"
                        value={component.id}
                      />
                      <input
                        type="hidden"
                        name="recipeId"
                        value={data.recipe.id}
                      />
                      <input
                        type="hidden"
                        name="versionId"
                        value={data.selected.id}
                      />
                      <div className="grid">
                        <label>
                          Cantidad · {component.unit}
                          <input
                            name="quantity"
                            type="number"
                            min="0.001"
                            step="0.001"
                            defaultValue={component.quantity}
                          />
                        </label>
                        <label>
                          Merma %
                          <input
                            name="wastePercent"
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            defaultValue={
                              Number(component.wasteFactor) * 100
                            }
                          />
                        </label>
                        <label>
                          Orden
                          <input
                            name="sequence"
                            type="number"
                            min="0"
                            defaultValue={component.sequence}
                          />
                        </label>
                        <label>
                          Nota
                          <input
                            name="notes"
                            defaultValue={component.notes ?? ""}
                          />
                        </label>
                      </div>
                      <button type="submit">Guardar componente</button>
                    </form>
                  )}

                  {editable && (
                    <form
                      action={removeRecipeComponent}
                      style={{ marginTop: ".5rem" }}
                    >
                      <input
                        type="hidden"
                        name="componentId"
                        value={component.id}
                      />
                      <input
                        type="hidden"
                        name="recipeId"
                        value={data.recipe.id}
                      />
                      <input
                        type="hidden"
                        name="versionId"
                        value={data.selected.id}
                      />
                      <button type="submit">Quitar componente</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editable && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>Publicar versión</h2>
          <p className="muted">
            La versión activa actual se archiva y este borrador pasa a ser la
            receta visible en operación.
          </p>
          <form action={publishRecipeDraft}>
            <input type="hidden" name="recipeId" value={data.recipe.id} />
            <input
              type="hidden"
              name="versionId"
              value={data.selected.id}
            />
            <button type="submit">Publicar esta versión</button>
          </form>
        </section>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/recipes">← Todas las recetas</Link>
      </p>
    </main>
  );
}
