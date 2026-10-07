import Link from "next/link";
import { getDecisionCenter } from "@/src/application/decision-center/read";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 1,
});

function change(value: number | null) {
  if (value == null) return "sin comparación";
  return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

function levelClass(level: "ACTION" | "WATCH" | "INFO") {
  return level === "ACTION"
    ? "status-warn"
    : level === "WATCH"
      ? "status-warn"
      : "muted";
}

function quadrantLabel(
  value: "STAR" | "WORKHORSE" | "PUZZLE" | "DOG",
) {
  if (value === "STAR") return "ESTRELLA";
  if (value === "WORKHORSE") return "CABALLO DE BATALLA";
  if (value === "PUZZLE") return "ROMPECABEZAS";
  return "BAJA PRIORIDAD";
}

export default async function DecisionCenterPage() {
  const { organizationId } = await requirePermission("admin.access");
  const data = await getDecisionCenter(organizationId);
  const { snapshot } = data;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">COO + CFO · CENTRO DE DECISIONES</p>
        <h1>Qué requiere atención hoy</h1>
        <p className="muted">
          Resume ventas, inventario, compras, tueste y productividad para
          convertir los datos en acciones concretas.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">HOY</span>
          <div className="metric">{money.format(snapshot.today.sales)}</div>
          <p>
            {snapshot.today.tickets} tickets · ticket{" "}
            {money.format(snapshot.today.avgTicket)}
          </p>
          <p className="muted">
            Contribución {money.format(snapshot.today.contribution)} ·{" "}
            {snapshot.today.contributionPct.toFixed(1)}%
          </p>
        </article>

        <article className="card">
          <span className="pill">7 DÍAS</span>
          <div className="metric">{money.format(snapshot.seven.sales)}</div>
          <p className={
            snapshot.seven.salesChangePct != null &&
            snapshot.seven.salesChangePct < 0
              ? "status-warn"
              : "status-ok"
          }>
            {change(snapshot.seven.salesChangePct)} vs periodo previo
          </p>
          <p className="muted">
            {snapshot.seven.tickets} tickets · margen{" "}
            {snapshot.seven.contributionPct.toFixed(1)}%
          </p>
        </article>

        <article className="card">
          <span className="pill">INVENTARIO</span>
          <div className="metric">{snapshot.criticalInventory}</div>
          <p>insumos críticos</p>
          <p className="muted">
            {snapshot.watchInventory} en vigilancia ·{" "}
            {snapshot.suggestedPurchases} reposiciones sugeridas
          </p>
        </article>

        <article className="card">
          <span className="pill">COMPRA SUGERIDA</span>
          <div className="metric">
            {money.format(snapshot.replenishmentBudget)}
          </div>
          <p>presupuesto estimado de reposición</p>
          <Link href="/admin/purchases">Abrir compras →</Link>
        </article>

        <article className="card">
          <span className="pill">TUESTE · 30 DÍAS</span>
          <div className="metric">{snapshot.batches30}</div>
          <p>batches registrados</p>
          <p className="muted">
            Merma media{" "}
            {snapshot.avgRoastLoss30 == null
              ? "—"
              : snapshot.avgRoastLoss30.toFixed(2) + "%"}
            {" · "}
            {snapshot.activeRoastAssignments} batch(es) en barra
          </p>
        </article>

        <article className="card">
          <span className="pill">PRODUCTIVIDAD · 14 DÍAS</span>
          <div className="metric">{snapshot.measuredTasks14}</div>
          <p>tareas con tiempo medible</p>
          <Link href="/admin/reports/productivity">
            Revisar productividad →
          </Link>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <p className="eyebrow">SIGUIENTES ACCIONES</p>
            <h2>Prioridades ordenadas</h2>
          </div>
          <div className="muted">
            Hora pico 30d:{" "}
            {snapshot.peakHour
              ? String(snapshot.peakHour.hour).padStart(2, "0") +
                ":00 · " +
                money.format(snapshot.peakHour.sales)
              : "sin muestra"}
          </div>
        </div>

        {data.decisions.length === 0 ? (
          <p className="status-ok">
            No hay alertas relevantes con los umbrales actuales.
          </p>
        ) : (
          <div className="stack">
            {data.decisions.map((decision, index) => (
              <article className="task" key={decision.title + index}>
                <div style={{ flex: 1 }}>
                  <div>
                    <span className="pill">{decision.area}</span>{" "}
                    <strong>{decision.title}</strong>
                  </div>
                  <div className={levelClass(decision.level)}>
                    {decision.detail}
                  </div>
                </div>
                <Link href={decision.href}>
                  <button>
                    {decision.level === "ACTION"
                      ? "Resolver"
                      : "Revisar"}
                  </button>
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <p className="eyebrow">INGENIERÍA DE MENÚ · HEURÍSTICA</p>
        <h2>Popularidad vs margen</h2>
        <p className="muted">
          Clasifica los productos usando mediana de unidades vendidas y mediana
          de margen de contribución dentro de la muestra de 30 días. Es una
          señal para investigar, no una decisión automática de eliminar o subir
          precios.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th>Clasificación</th>
                <th>Unidades</th>
                <th>Venta</th>
                <th>Contribución</th>
                <th>Margen</th>
              </tr>
            </thead>
            <tbody>
              {data.menuEngineering.map((product) => (
                <tr key={product.name}>
                  <td>
                    <strong>{product.name}</strong>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {quadrantLabel(product.quadrant)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(product.qty)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money.format(product.sales)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money.format(product.contribution)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {product.contributionPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted" style={{ marginTop: ".7rem" }}>
          Umbral popularidad: {number.format(data.menuThresholds.medianQty)}{" "}
          unidades · umbral margen:{" "}
          {data.menuThresholds.medianMargin.toFixed(1)}%.
        </p>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <p className="eyebrow">15 DÍAS</p>
          <div className="metric">{money.format(snapshot.fifteen.sales)}</div>
          <p>
            {snapshot.fifteen.tickets} tickets · ticket{" "}
            {money.format(snapshot.fifteen.avgTicket)}
          </p>
          <p className="muted">
            {change(snapshot.fifteen.salesChangePct)} vs periodo previo
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">30 DÍAS</p>
          <div className="metric">{money.format(snapshot.thirty.sales)}</div>
          <p>
            {snapshot.thirty.tickets} tickets ·{" "}
            {snapshot.thirty.itemsPerTicket.toFixed(2)} unidades/ticket
          </p>
          <p className="muted">
            COGS {money.format(snapshot.thirty.cogs)} · contribución{" "}
            {money.format(snapshot.thirty.contribution)}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">CALIDAD DE DATOS</p>
          <div className="metric">
            {data.dataQuality.itemsWithoutCost +
              data.dataQuality.itemsWithoutSupplier +
              data.dataQuality.lotsWithoutLoyverse}
          </div>
          <p>configuraciones pendientes</p>
          <p className="muted">
            {data.dataQuality.itemsWithoutCost} sin costo ·{" "}
            {data.dataQuality.itemsWithoutSupplier} sin proveedor ·{" "}
            {data.dataQuality.lotsWithoutLoyverse} cafés sin Loyverse
          </p>
        </article>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
