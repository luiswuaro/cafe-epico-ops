import Link from "next/link";
import { refreshAnalytics } from "./actions";
import { getBusinessAnalytics } from "@/src/application/analytics/business";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money0 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const money2 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 1,
});

function change(value: number | null) {
  if (value == null) return "sin comparación";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function periodTone(value: number | null) {
  if (value == null) return "muted";
  return value < 0 ? "status-warn" : "status-ok";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("admin.access");
  const data = await getBusinessAnalytics(organizationId);

  const maxDaily = Math.max(1, ...data.daily.map((row) => row.sales));
  const maxHourly = Math.max(1, ...data.hourly.map((row) => row.sales));
  const period30 = data.periods.find((period) => period.key === "30d")!;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · DASHBOARD GERENCIAL</p>
        <h1>Ventas, margen y operación</h1>
        <p className="muted">
          Ventana gratuita de Loyverse: hasta 30 días contando el día corriente.
          COGS POS conserva el costo grabado en cada ticket al momento de la
          venta.
        </p>
      </section>

      {params.refreshed === "1" && (
        <p className="card status-ok">
          Ventas y clientes actualizados desde Loyverse.
        </p>
      )}
      {typeof params.error === "string" && (
        <p className="alert">Error al actualizar: {params.error}</p>
      )}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <form action={refreshAnalytics}>
          <button type="submit">Actualizar dashboard ahora</button>
        </form>
        <p className="muted" style={{ marginTop: ".5rem" }}>
          Normalmente la sincronización incremental corre sola. Este botón sirve
          para forzar un backfill manual de la ventana disponible.
        </p>
      </section>

      <section className="grid">
        {data.periods.map((period) => (
          <article className="card" key={period.key}>
            <p className="eyebrow">{period.label.toUpperCase()}</p>
            <div className="metric">{money0.format(period.sales)}</div>
            <p>
              {period.tickets} tickets · ticket{" "}
              {money0.format(period.avgTicket)}
            </p>
            <p className={periodTone(period.salesChangePct)}>
              Ventas {change(period.salesChangePct)}
              {period.previousSales != null ? " vs periodo previo" : ""}
            </p>
            <div className="muted">
              COGS {money0.format(period.cogs)} · contribución{" "}
              {money0.format(period.contribution)} (
              {period.contributionPct.toFixed(1)}%)
            </div>
          </article>
        ))}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Métricas comparables</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Periodo</th>
                <th>Venta</th>
                <th>Tickets</th>
                <th>Ticket prom.</th>
                <th>Unid.</th>
                <th>Unid./ticket</th>
                <th>COGS</th>
                <th>Contribución</th>
                <th>Margen</th>
                <th>Descuento</th>
                <th>Lealtad</th>
              </tr>
            </thead>
            <tbody>
              {data.periods.map((period) => (
                <tr key={period.key}>
                  <td><strong>{period.label}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(period.sales)}
                  </td>
                  <td style={{ textAlign: "right" }}>{period.tickets}</td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(period.avgTicket)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(period.units)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {period.itemsPerTicket.toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(period.cogs)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(period.contribution)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {period.contributionPct.toFixed(1)}%
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(period.discounts)} (
                    {period.discountRate.toFixed(1)}%)
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {period.captureRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <p className="eyebrow">30 DÍAS · RENTABILIDAD</p>
          <div className="metric">
            {period30.contributionPct.toFixed(1)}%
          </div>
          <p>
            Contribución {money0.format(period30.contribution)} sobre ventas de{" "}
            {money0.format(period30.sales)}.
          </p>
          <p className="muted">
            IVA incluido registrado: {money0.format(period30.tax)} · propinas{" "}
            {money0.format(period30.tips)}.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">OPERACIÓN · TURNOS</p>
          <div className="metric">
            {period30.sales > 0
              ? ((period30.afternoonSales / period30.sales) * 100).toFixed(0)
              : "0"}%
          </div>
          <p>de la venta ocurre desde las 16:00.</p>
          <p className="muted">
            Mañana {money0.format(period30.morningSales)} · tarde{" "}
            {money0.format(period30.afternoonSales)}.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">HORA MÁS FUERTE</p>
          <div className="metric">
            {data.peakHour
              ? String(data.peakHour.hour).padStart(2, "0") + ":00"
              : "—"}
          </div>
          <p>
            {data.peakHour
              ? `${data.peakHour.tickets} tickets · ${money0.format(
                  data.peakHour.sales,
                )}`
              : "Sin ventas suficientes."}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">LEALTAD</p>
          <div className="metric">{period30.captureRate.toFixed(1)}%</div>
          <p>tickets identificados en 30 días.</p>
          <p className="muted">
            {data.loyalty.new7} altas 7d · {data.loyalty.new15} altas 15d ·{" "}
            {data.loyalty.new30} altas 30d.
          </p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Venta diaria · últimos 30 días</h2>
        <div className="stack">
          {data.daily.map((row) => (
            <div key={row.date}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                }}
              >
                <strong>{row.date}</strong>
                <span>
                  {money0.format(row.sales)} · {row.tickets} tickets · margen{" "}
                  {row.contributionPct.toFixed(0)}%
                </span>
              </div>
              <div
                style={{
                  height: ".6rem",
                  background: "rgba(127,127,127,.15)",
                  borderRadius: "999px",
                  overflow: "hidden",
                  marginTop: ".25rem",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(row.sales / maxDaily) * 100}%`,
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
                    {row.tickets} tickets · {money0.format(row.sales)}
                  </span>
                </div>
                <div
                  style={{
                    height: ".45rem",
                    background: "rgba(127,127,127,.15)",
                    borderRadius: "999px",
                    overflow: "hidden",
                    marginTop: ".2rem",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(row.sales / maxHourly) * 100}%`,
                      background: "currentColor",
                      opacity: 0.5,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Métodos de pago · 30 días</h2>
          <div className="stack">
            {data.payments.map((payment) => (
              <div className="task" key={payment.name}>
                <strong>{payment.name}</strong>
                <span>{money0.format(payment.sales)}</span>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: "1rem" }}>Consumo / servicio</h2>
          <div className="stack">
            {data.dining.map((row) => (
              <div className="task" key={row.name}>
                <strong>{row.name}</strong>
                <span>
                  {row.tickets} tickets · {money0.format(row.sales)}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Categorías · 30 días</h2>
          {data.categories30.map((category) => (
            <div className="task" key={category.name}>
              <div style={{ flex: 1 }}>
                <strong>{category.name}</strong>
                <div className="muted">
                  {number.format(category.qty)} unidades · margen{" "}
                  {category.contributionPct.toFixed(1)}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>{money0.format(category.sales)}</strong>
                <div className="muted">
                  contrib. {money0.format(category.contribution)}
                </div>
              </div>
            </div>
          ))}
        </article>

        <article className="card">
          <h2>Lealtad · base de clientes</h2>
          <div className="metric">{data.loyalty.customers}</div>
          <p>clientes registrados.</p>
          <p>
            {data.loyalty.activated} con ≥1 visita · {data.loyalty.repeat} con
            ≥2 visitas.
          </p>
          <p className="muted">
            Visitas promedio {data.loyalty.averageVisits.toFixed(2)} · gasto
            acumulado promedio {money0.format(data.loyalty.averageSpent)}.
          </p>

          <h2 style={{ marginTop: "1rem" }}>Sugerencias</h2>
          {data.suggestions.length === 0 ? (
            <p className="muted">
              Sin alertas gerenciales automáticas con los umbrales actuales.
            </p>
          ) : (
            <div className="stack">
              {data.suggestions.map((suggestion) => (
                <div className="task" key={suggestion.title}>
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
          )}
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Productos · 30 días</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Producto</th>
                <th>Unidades</th>
                <th>Venta</th>
                <th>Descuento</th>
                <th>COGS POS</th>
                <th>Contribución</th>
                <th>Margen</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((item) => (
                <tr key={item.name}>
                  <td><strong>{item.name}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(item.qty)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(item.sales)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money2.format(item.discounts)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(item.cogs)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {money0.format(item.contribution)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {item.contributionPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
