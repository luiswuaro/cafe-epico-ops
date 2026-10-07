import Link from "next/link";
import { recordOperationalEvent } from "./actions";
import { getLoyverseInventoryView } from "@/src/application/loyverse/inventory-view";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";

export const dynamic = "force-dynamic";

export default async function OperationalReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();
  const inventory = await getLoyverseInventoryView(employee.organizationId);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BARRA · REPORTE RÁPIDO</p>
        <h1>Merma o incidencia</h1>
        <p className="muted">
          Registra lo que pasó en menos de un minuto. Las mermas de insumo se
          usan después para conciliar el inventario teórico contra la caída
          real observada en Loyverse.
        </p>
      </section>

      {params.saved === "1" && (
        <p className="card status-ok">Evento registrado.</p>
      )}
      {typeof params.error === "string" && (
        <p className="alert">
          No se pudo guardar. Revisa tipo, nota y cantidad.
        </p>
      )}

      <section className="grid">
        <form action={recordOperationalEvent} className="card stack">
          <h2>Nuevo evento</h2>

          <label>
            Tipo
            <select name="eventType" defaultValue="WASTE" required>
              <option value="WASTE">Merma de insumo</option>
              <option value="REMAKE">Bebida rehecha</option>
              <option value="EQUIPMENT">Equipo / falla</option>
              <option value="STOCK">Faltante / stock</option>
              <option value="SERVICE">Servicio / cliente</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>

          <label>
            Prioridad
            <select name="severity" defaultValue="NORMAL" required>
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Importante</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </label>

          <label>
            Insumo relacionado
            <select name="variantExternalId" defaultValue="">
              <option value="">Sin insumo</option>
              {inventory.rows.map((row) => {
                const dryPattern =
                  /(CAFE|CAFÉ|MATCHA|TARO|CACAO|POLVO|AZUCAR|AZÚCAR|CANELA|HIELO)/i;
                const unit =
                  row.displayUnit ??
                  (row.soldByWeight
                    ? dryPattern.test(row.itemName)
                      ? "g"
                      : "ml"
                    : "pz");
                const factor =
                  row.displayUnit && row.displayFactor > 0
                    ? row.displayFactor
                    : row.soldByWeight
                      ? 1000
                      : 1;
                return (
                  <option
                    key={row.variantExternalId}
                    value={row.variantExternalId}
                  >
                    {row.itemName} · stock{" "}
                    {(row.inStock * factor).toFixed(1)} {unit}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            Cantidad · usa la unidad mostrada en el insumo (g / ml / pz)
            <input
              name="quantity"
              type="number"
              inputMode="decimal"
              min="0.001"
              step="0.001"
              placeholder="Obligatoria para merma"
            />
          </label>

          <label>
            Qué pasó
            <textarea
              name="note"
              rows={4}
              maxLength={1000}
              placeholder="Ej. se derramaron 250 ml de leche al texturizar; molino hizo ruido; faltó tónica..."
            />
          </label>

          <button type="submit">Registrar</button>
        </form>

        <article className="card">
          <h2>Cómo usarlo</h2>
          <div className="stack">
            <div>
              <strong>Merma de insumo</strong>
              <div className="muted">
                Selecciona el insumo y registra la cantidad realmente perdida.
              </div>
            </div>
            <div>
              <strong>Bebida rehecha</strong>
              <div className="muted">
                Registra qué bebida se repitió y por qué. Sirve para detectar
                retrabajo y problemas de calidad.
              </div>
            </div>
            <div>
              <strong>Equipo / falla</strong>
              <div className="muted">
                Usa Importante o Crítica cuando la falla pueda afectar el
                servicio o la calidad.
              </div>
            </div>
            <div>
              <strong>Faltante / stock</strong>
              <div className="muted">
                Úsalo cuando la existencia física no coincida con lo que
                muestra el sistema.
              </div>
            </div>
          </div>
        </article>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/today">← Volver a Hoy</Link>
      </p>
    </main>
  );
}
