import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { recordEspressoQualityCheck } from "./actions";
import { listActiveRecipes } from "@/src/application/recipes/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  recipes as recipesTable,
  recipeVersions,
} from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const EXTRACTION_NAMES = new Set([
  "Ristretto base 1:1",
  "Espresso base 1:2",
  "Lungo base 1:2.5",
]);

const sensoryLabels: Record<string, string> = {
  CORRECTO: "Correcto",
  ACIDO: "Ácido",
  AMARGO: "Amargo",
  ASTRINGENTE: "Astringente",
  OTRO: "Otro",
};

export default async function EspressoQcPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    return (
      <main className="shell">
        <p className="alert">Tu empleado no tiene sucursal asignada.</p>
      </main>
    );
  }

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    employee.homeStoreId,
  );

  const recipes = (await listActiveRecipes(employee.organizationId)).filter(
    (recipe) => EXTRACTION_NAMES.has(recipe.name),
  );

  const recent = await getDb()
    .select({
      id: espressoQualityChecks.id,
      doseG: espressoQualityChecks.doseG,
      yieldG: espressoQualityChecks.yieldG,
      brewTimeS: espressoQualityChecks.brewTimeS,
      sensoryRating: espressoQualityChecks.sensoryRating,
      sensoryNotes: espressoQualityChecks.sensoryNotes,
      withinTimeSpec: espressoQualityChecks.withinTimeSpec,
      withinYieldSpec: espressoQualityChecks.withinYieldSpec,
      createdAt: espressoQualityChecks.createdAt,
      recipeName: recipesTable.name,
    })
    .from(espressoQualityChecks)
    .leftJoin(
      recipeVersions,
      eq(recipeVersions.id, espressoQualityChecks.recipeVersionId),
    )
    .leftJoin(recipesTable, eq(recipesTable.id, recipeVersions.recipeId))
    .where(
      and(
        eq(
          espressoQualityChecks.organizationId,
          employee.organizationId,
        ),
        eq(espressoQualityChecks.storeId, employee.homeStoreId),
      ),
    )
    .orderBy(desc(espressoQualityChecks.createdAt))
    .limit(8);

  const saved = params.saved === "1";
  const overall = params.overall === "1";
  const timeOk = params.time === "1";
  const yieldOk = params.yield === "1";
  const ratio =
    typeof params.ratio === "string" ? Number(params.ratio) : null;
  const error =
    typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CONTROL DE CALIDAD</p>
        <h1>Espresso de apertura</h1>
        <p className="muted">
          El control pasa solo cuando <strong>yield/ratio y tiempo</strong>{" "}
          están dentro de la especificación de la extracción elegida.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">RISTRETTO</span>
          <div className="metric">1:1–1:1.5</div>
          <p>15–25 s</p>
          <p className="muted">
            Con 18 g: yield válido de 18 a 27 g.
          </p>
        </article>
        <article className="card">
          <span className="pill">ESPRESSO</span>
          <div className="metric">1:2</div>
          <p>±2 g · 22–35 s</p>
          <p className="muted">
            Con 18 g: yield válido de 34 a 38 g.
          </p>
        </article>
        <article className="card">
          <span className="pill">LUNGO</span>
          <div className="metric">1:2.5</div>
          <p>±2 g · 30–40 s</p>
          <p className="muted">
            Con 18 g: yield válido de 43 a 47 g.
          </p>
        </article>
      </section>

      {saved && (
        <section
          className={overall ? "card status-ok" : "alert status-warn"}
          style={{ marginTop: "1rem" }}
        >
          <strong>
            {overall
              ? "Control dentro de especificación."
              : "Control guardado FUERA de especificación."}
          </strong>
          <div>
            Ratio real:{" "}
            {ratio == null || Number.isNaN(ratio)
              ? "—"
              : `1:${ratio.toFixed(2)}`}
            {" · "}
            Tiempo: {timeOk ? "OK" : "FUERA"}
            {" · "}
            Yield/ratio: {yieldOk ? "OK" : "FUERA"}
          </div>
          {!overall && (
            <p>
              No se considera un espresso de control aprobado. Reportar y
              revisar calibración/SOP antes de darlo por bueno.
            </p>
          )}
        </section>
      )}

      {error && (
        <p className="alert">
          No se pudo guardar el control. Selecciona una extracción y revisa
          dosis, yield y tiempo.
        </p>
      )}

      <div className="grid" style={{ marginTop: "1rem" }}>
        <form action={recordEspressoQualityCheck} className="card stack">
          <label>
            Extracción
            <select name="recipeVersionId" defaultValue="" required>
              <option value="" disabled>
                Selecciona…
              </option>
              {recipes.map((recipe) => (
                <option key={recipe.versionId} value={recipe.versionId}>
                  {recipe.name} · v{recipe.majorVersion}.
                  {recipe.minorVersion}
                </option>
              ))}
            </select>
          </label>

          <label>
            Dosis (g)
            <input
              name="doseG"
              type="number"
              inputMode="decimal"
              min="0.1"
              max="30"
              step="0.1"
              placeholder="18.0"
              required
            />
          </label>

          <label>
            Yield (g)
            <input
              name="yieldG"
              type="number"
              inputMode="decimal"
              min="0.1"
              max="100"
              step="0.1"
              placeholder="36.0"
              required
            />
          </label>

          <label>
            Tiempo (s)
            <input
              name="brewTimeS"
              type="number"
              inputMode="decimal"
              min="0.1"
              max="120"
              step="0.1"
              placeholder="28.0"
              required
            />
          </label>

          <label>
            Evaluación sensorial
            <select
              name="sensoryRating"
              defaultValue="CORRECTO"
              required
            >
              <option value="CORRECTO">Correcto</option>
              <option value="ACIDO">Ácido</option>
              <option value="AMARGO">Amargo</option>
              <option value="ASTRINGENTE">Astringente</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>

          <label>
            Observaciones
            <input
              name="sensoryNotes"
              maxLength={1000}
              placeholder="Opcional"
            />
          </label>

          <button type="submit">Guardar control</button>
        </form>

        <section className="card">
          <h2>Últimos controles</h2>
          {recent.length === 0 ? (
            <p className="muted">Todavía no hay controles registrados.</p>
          ) : (
            <div className="stack">
              {recent.map((row) => {
                const dose = Number(row.doseG);
                const yieldG = Number(row.yieldG);
                const rowRatio =
                  dose > 0 ? yieldG / dose : null;
                const passed =
                  row.withinTimeSpec &&
                  row.withinYieldSpec === true;

                return (
                  <div className="task" key={row.id}>
                    <div style={{ flex: 1 }}>
                      <div>
                        <strong>
                          {row.recipeName ?? "Extracción"} · {row.doseG} g →{" "}
                          {row.yieldG} g · {row.brewTimeS} s
                        </strong>{" "}
                        <span
                          className={
                            passed ? "status-ok" : "status-warn"
                          }
                        >
                          {passed ? "APROBADO" : "FUERA"}
                        </span>
                      </div>
                      <div className="muted">
                        Ratio{" "}
                        {rowRatio == null
                          ? "—"
                          : `1:${rowRatio.toFixed(2)}`}
                        {" · "}
                        Tiempo {row.withinTimeSpec ? "OK" : "FUERA"}
                        {" · "}
                        Yield{" "}
                        {row.withinYieldSpec === true
                          ? "OK"
                          : row.withinYieldSpec === false
                            ? "FUERA"
                            : "sin validar"}
                      </div>
                      <div className="muted">
                        {sensoryLabels[row.sensoryRating] ??
                          row.sensoryRating}
                        {row.sensoryNotes
                          ? ` · ${row.sensoryNotes}`
                          : ""}
                        {" · "}
                        {row.createdAt.toLocaleString("es-MX", {
                          timeZone: "America/Mexico_City",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p style={{ marginTop: "1rem" }}>
            <Link href="/sops">Consultar SOPs →</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
