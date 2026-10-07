import Link from "next/link";
import { getBusinessAnalytics } from "@/src/application/analytics/business";
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
  if (value == null) return "sin base";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default async function AnalyticsPage() {
  const { organizationId } = await requirePermission("admin.access");
  const data = await getBusinessAnalytics(organizationId);

  const maxHourly = Math.max(
    1,
    ...data.hourly.map((row) => row.sales),
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · ANALÍTICA</p>
        <h1>Estado del negocio</h1>
        <p className="muted">
          Datos del espejo de Loyverse. Corte operativo provisional:
          mañana &lt; 16:00 · tarde ≥ 16:00.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <span className="pill">VENTA · 7 DÍAS</span>
          <div className="metric">
            {money.format(data.trend.current.sales)}
          </div>
          <p className={data.trend.salesChange != null && data.trend.salesChange < 0 ? "status-warn" : "status-ok"}>
            {change(data.trend.salesChange)} vs 7 días previos
          </p>
        </article>
        <article className="card">
          <span className="pill">TICKETS · 7 DÍAS</span>
          <div className="metric">{data.trend.current.tickets}</div>
          <p className={data.trend.ticketsChange != null && data.trend.ticketsChange < 0 ? "status-warn" : "status-ok"}>
            {change(data.trend.ticketsChange)}
          </p>
        </article>
        <article className="card">
          <span className="pill">TICKET PROMEDIO</span>
          <div className="metric">
            {money.format(data.trend.currentAvgTicket)}
          </div>
          <p>{change(data.trend.avgTicketChange)}</p>
        </article>
        <article className="card">
          <span className="pill">CAPTURA LEALTAD</span>
          <div className="metric">
            {data.loyalty.captureRate.toFixed(1)}%
          </div>
          <p>tickets asociados a cliente · 30 días</p>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        {[
          { label: "Mañana", row: data.shift.morning },
          { label: "Tarde", row: data.shift.afternoon },
        ].map(({ label, row }) => {
          return (
            <article className="card" key={label}>
              <p className="eyebrow">TURNO · {label}</p>
              <div className="metric">{money.format(row.sales)}</div>
              <p>
                {row.tickets} tickets ·{" "}
                {number.format(row.beverageUnits)} bebidas ·{" "}
                {number.format(row.foodUnits)} alimentos
              </p>
              <p className="muted">
                Ticket {money.format(row.avgTicket)} · cliente identificado{" "}
                {row.captureRate.toFixed(1)}%
              </p>
            </article>
          );
        })}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Ventas por hora · 30 días</h2>
        <div className="stack">
          {data.hourly.map((row) => (
            <div key={row.hour}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <strong>{String(row.hour).padStart(2, "0")}:00</strong>
                <span>
                  {row.tickets} tickets · {money.format(row.sales)}
                </span>
              </div>
              <div
                style={{
                  height: ".5rem",
                  background: "rgba(127,127,127,.15)",
                  borderRadius: "999px",
                  overflow: "hidden",
                  marginTop: ".25rem",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(row.sales / maxHourly) * 100}%`,
                    background: "currentColor",
                    opacity: 0.55,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Lealtad</h2>
          <div className="metric">{data.loyalty.customers}</div>
          <p>clientes registrados</p>
          <p>
            {data.loyalty.new7} nuevos 7d · {data.loyalty.new30} nuevos 30d
          </p>
          <p>
            {data.loyalty.activated} con ≥1 visita · {data.loyalty.repeat} con
            ≥2 visitas
          </p>
          <p className="muted">
            Visitas promedio {data.loyalty.averageVisits.toFixed(2)} · gasto
            acumulado promedio {money.format(data.loyalty.averageSpent)}
          </p>
        </article>

        <article className="card">
          <h2>Tendencias y sugerencias</h2>
          <div className="stack">
            {data.suggestions.map((suggestion, index) => (
              <div className="task" key={`${suggestion.title}-${index}`}>
                <div>
                  <strong>{suggestion.title}</strong>
                  <div
                    className={
                      suggestion.level === "ACTION"
                        ? "status-warn"
                        : "muted"
                    }
                  >
                    {suggestion.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Top · mañana</h2>
          {data.topMorning.map((item, index) => (
            <div className="task" key={item.name}>
              <strong>
                {index + 1}. {item.name}
              </strong>
              <span>
                {number.format(item.qty)} · {money.format(item.sales)}
              </span>
            </div>
          ))}
        </article>
        <article className="card">
          <h2>Top · tarde</h2>
          {data.topAfternoon.map((item, index) => (
            <div className="task" key={item.name}>
              <strong>
                {index + 1}. {item.name}
              </strong>
              <span>
                {number.format(item.qty)} · {money.format(item.sales)}
              </span>
            </div>
          ))}
        </article>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
