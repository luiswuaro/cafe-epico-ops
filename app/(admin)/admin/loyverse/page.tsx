import Link from "next/link";
import { runLoyverseSync } from "./actions";
import { getLoyverseStatus } from "@/src/application/loyverse/status";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const labels: Record<string, string> = {
  stores: "Tiendas",
  categories: "Categorías",
  items: "Artículos + variantes",
  inventory: "Inventario POS",
  customers: "Clientes",
  receipts30: "Ventas y tickets · 30 días",
};

export default async function LoyverseAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("integration.read");
  const status = await getLoyverseStatus(organizationId);
  const ok = typeof params.ok === "string" ? params.ok : null;
  const count = typeof params.count === "string" ? params.count : null;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · LOYVERSE</p>
        <h1>Integración Loyverse</h1>
        <p className="muted">
          Loyverse es la fuente maestra de artículos, recetas comerciales e inventario. Ops lo espeja para operación, análisis y control técnico.
        </p>
      </section>

      {ok && (
        <p className="card status-ok">
          Sincronización completada: {labels[ok] ?? ok} · {count ?? "0"} registros leídos.
        </p>
      )}
      {error && <p className="alert">Sincronización fallida: {error}</p>}

      <section className="grid">
        <article className="card">
          <span className="pill">ESTADO</span>
          <div className="metric">{status.connection?.status ?? "DISCONNECTED"}</div>
          <p className="muted">
            El token permanece exclusivamente en variables de entorno de Vercel.
          </p>
        </article>

        <article className="card">
          <span className="pill">ESPEJO ACTUAL</span>
          <p>Tiendas: <strong>{status.counts.stores}</strong></p>
          <p>Artículos: <strong>{status.counts.items}</strong></p>
          <p>Variantes: <strong>{status.counts.variants}</strong></p>
          <p>Niveles inventario: <strong>{status.counts.inventoryLevels}</strong></p>
          <p>Clientes: <strong>{status.counts.customers}</strong></p>
          <p>Recibos: <strong>{status.counts.receipts}</strong></p>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        {Object.entries(labels).map(([resource, label]) => {
          const state = status.states.find((row) => row.resource === resource);
          return (
            <form action={runLoyverseSync} className="card stack" key={resource}>
              <input type="hidden" name="resource" value={resource} />
              <h2>{label}</h2>
              <p className="muted">
                Estado: {state?.status ?? "SIN EJECUTAR"}
                {state?.lastSuccessfulSyncAt
                  ? ` · última OK ${state.lastSuccessfulSyncAt.toLocaleString("es-MX", {
                      timeZone: "America/Mexico_City",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}`
                  : ""}
              </p>
              {state?.errorMessage && (
                <p className="status-warn">{state.errorMessage}</p>
              )}
              <button type="submit">Sincronizar {label}</button>
            </form>
          );
        })}
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Inventario</h2>
          <p className="muted">
            La existencia se lee directamente de Loyverse. Ya no hay mapeo,
            saldo inicial ni inventario paralelo en Ops.
          </p>
          <Link href="/inventory">
            Ver inventario Loyverse →
          </Link>
        </article>
        <article className="card">
          <h2>Recetas fuente</h2>
          <p className="muted">
            Revisa recetas anidadas: componentes directos y consumo real
            expandido hasta insumos base.
          </p>
          <Link href="/admin/loyverse/recipes">
            Ver composiciones →
          </Link>
        </article>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
