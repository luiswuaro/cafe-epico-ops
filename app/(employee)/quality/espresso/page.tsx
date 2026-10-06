import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { recordEspressoQualityCheck } from "./actions";
import { listActiveRecipes } from "@/src/application/recipes/read";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { espressoQualityChecks } from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
    return <main className="shell"><p className="alert">Tu empleado no tiene sucursal asignada.</p></main>;
  }

  await assertEmployeePermission(employee.id, "checklist.execute", employee.homeStoreId);

  const recipes = await listActiveRecipes(employee.organizationId);
  const recent = await getDb()
    .select({
      id: espressoQualityChecks.id,
      doseG: espressoQualityChecks.doseG,
      yieldG: espressoQualityChecks.yieldG,
      brewTimeS: espressoQualityChecks.brewTimeS,
      sensoryRating: espressoQualityChecks.sensoryRating,
      sensoryNotes: espressoQualityChecks.sensoryNotes,
      withinTimeSpec: espressoQualityChecks.withinTimeSpec,
      createdAt: espressoQualityChecks.createdAt,
    })
    .from(espressoQualityChecks)
    .where(and(
      eq(espressoQualityChecks.organizationId, employee.organizationId),
      eq(espressoQualityChecks.storeId, employee.homeStoreId),
    ))
    .orderBy(desc(espressoQualityChecks.createdAt))
    .limit(5);

  const saved = params.saved === "1";
  const within = params.within === "1";
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CONTROL DE CALIDAD</p>
        <h1>Espresso de apertura</h1>
        <p className="muted">Rango operativo de tiempo configurado: 22–35 s.</p>
      </section>

      {saved && (
        <p className={within ? "card status-ok" : "alert status-warn"}>
          {within
            ? "Control guardado. Tiempo dentro de especificación."
            : "Control guardado. Tiempo fuera de 22–35 s: reportar y revisar el SOP antes de ajustar el molino."}
        </p>
      )}

      {error && <p className="alert">No se pudo guardar el control. Revisa los valores e inténtalo nuevamente.</p>}

      <div className="grid">
        <form action={recordEspressoQualityCheck} className="card stack">
          <label>
            Ratio / receta de control
            <select name="recipeVersionId" defaultValue="">
              <option value="">Sin seleccionar</option>
              {recipes.map((recipe) => (
                <option key={recipe.versionId} value={recipe.versionId}>
                  {recipe.name} · v{recipe.majorVersion}.{recipe.minorVersion}
                </option>
              ))}
            </select>
          </label>

          <label>
            Dosis (g)
            <input name="doseG" type="number" inputMode="decimal" min="0.1" max="30" step="0.1" placeholder="18.0" required />
          </label>

          <label>
            Yield (g)
            <input name="yieldG" type="number" inputMode="decimal" min="0.1" max="100" step="0.1" placeholder="36.0" required />
          </label>

          <label>
            Tiempo (s)
            <input name="brewTimeS" type="number" inputMode="decimal" min="0.1" max="120" step="0.1" placeholder="28.0" required />
          </label>

          <label>
            Evaluación sensorial
            <select name="sensoryRating" defaultValue="CORRECTO" required>
              <option value="CORRECTO">Correcto</option>
              <option value="ACIDO">Ácido</option>
              <option value="AMARGO">Amargo</option>
              <option value="ASTRINGENTE">Astringente</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>

          <label>
            Observaciones
            <input name="sensoryNotes" maxLength={1000} placeholder="Opcional" />
          </label>

          <button type="submit">Guardar control</button>
          <p className="muted">El sistema evalúa automáticamente el tiempo. No cambia la calibración ni escribe a Loyverse.</p>
        </form>

        <section className="card">
          <h2>Últimos controles</h2>
          {recent.length === 0 ? (
            <p className="muted">Todavía no hay controles registrados.</p>
          ) : (
            <div className="stack">
              {recent.map((row) => (
                <div key={row.id}>
                  <div>
                    <strong>{row.doseG} g → {row.yieldG} g · {row.brewTimeS} s</strong>{" "}
                    <span className={row.withinTimeSpec ? "status-ok" : "status-warn"}>
                      {row.withinTimeSpec ? "EN RANGO" : "FUERA DE RANGO"}
                    </span>
                  </div>
                  <div className="muted">
                    {sensoryLabels[row.sensoryRating] ?? row.sensoryRating}
                    {row.sensoryNotes ? ` · ${row.sensoryNotes}` : ""}
                    {" · "}
                    {row.createdAt.toLocaleString("es-MX", {
                      timeZone: "America/Mexico_City",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginTop: "1rem" }}><Link href="/sops">Consultar SOPs →</Link></p>
        </section>
      </div>
    </main>
  );
}
