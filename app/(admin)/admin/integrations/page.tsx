import { runLoyverseSync } from "./actions";
import { getLoyverseIntegrationStatus } from "@/src/application/loyverse/status";
import {
  employeeHasPermission,
  requirePermission,
} from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { employeeId, organizationId } =
    await requirePermission("integration.read");

  const [status, canManage] = await Promise.all([
    getLoyverseIntegrationStatus(organizationId),
    employeeHasPermission(employeeId, "integration.manage"),
  ]);

  const resources = [
    ["stores", "Tiendas", status.counts.stores],
    ["items", "Artículos + variantes", status.counts.items],
    ["inventory", "Niveles de inventario", status.counts.inventoryLevels],
    ["customers", "Clientes", status.counts.customers],
    ["receipts30", "Tickets · últimos 30 días", status.counts.receipts],
  ] as const;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · INTEGRACIONES</p>
        <h1>Loyverse</h1>
        <p className="muted">
          Espejo de solo lectura. Café Épico Ops no escribe inventario ni ventas de regreso a Loyverse.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Conexión</h2>
          <div className="metric">
            {status.configured ? "LISTA" : "SIN TOKEN"}
          </div>
          <p>
            Estado interno: <strong>{status.connectionStatus}</strong>
          </p>
          <p className={status.configured ? "status-ok" : "status-warn"}>
            {status.configured
              ? "LOYVERSE_ACCESS_TOKEN está configurado en el servidor."
              : "Falta LOYVERSE_ACCESS_TOKEN en Vercel."}
          </p>
        </article>

        <article className="card">
          <h2>Espejo actual</h2>
          <div className="stack">
            <div>Tiendas: <strong>{status.counts.stores}</strong></div>
            <div>Artículos: <strong>{status.counts.items}</strong></div>
            <div>Variantes: <strong>{status.counts.variants}</strong></div>
            <div>Inventario POS: <strong>{status.counts.inventoryLevels}</strong></div>
            <div>Clientes: <strong>{status.counts.customers}</strong></div>
            <div>Tickets: <strong>{status.counts.receipts}</strong></div>
          </div>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Sincronización manual</h2>
        <p className="muted">
          Ejecuta recursos por separado para reducir riesgo de timeout. Primero tiendas, luego artículos, inventario, clientes y tickets.
        </p>

        {!canManage ? (
          <p className="alert">Tu rol no puede administrar integraciones.</p>
        ) : !status.configured ? (
          <p className="status-warn">
            Configura el token antes de ejecutar sincronizaciones.
          </p>
        ) : (
          <div className="grid">
            {resources.map(([resource, label, count]) => (
              <form action={runLoyverseSync} className="card" key={resource}>
                <input type="hidden" name="resource" value={resource} />
                <strong>{label}</strong>
                <p className="muted">Espejo actual: {count}</p>
                <button type="submit">Sincronizar</button>
              </form>
            ))}
            <form action={runLoyverseSync} className="card">
              <input type="hidden" name="resource" value="receipts90" />
              <strong>Tickets · backfill 90 días</strong>
              <p className="muted">
                Úsalo después de validar primero el pull de 30 días.
              </p>
              <button type="submit">Sincronizar 90 días</button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
