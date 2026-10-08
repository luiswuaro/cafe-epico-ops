import { refreshLoyverseReceipts } from "./actions";
import { getLoyverseReceiptsView } from "@/src/application/loyverse/receipts";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function localDateTime(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function LoyverseReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("integration.read");
  const data = await getLoyverseReceiptsView(organizationId, 30, 120);

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const today = data.rows.filter(
    (row) =>
      row.receiptDate &&
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(row.receiptDate) === todayKey,
  );
  const validToday = today.filter(
    (row) => row.status === "VALID" && row.receiptType === "SALE",
  );
  const cancelledToday = today.filter(
    (row) => row.status === "CANCELLED",
  );

  return (
    <main className="shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">LOYVERSE · RECIBOS</p>
          <h1>Recibos sincronizados</h1>
          <p className="muted">
            Vista operativa del espejo de Loyverse. Las ventas canceladas se
            conservan para auditoría, pero no cuentan como venta neta.
          </p>
        </div>
        <form action={refreshLoyverseReceipts}>
          <button type="submit">Sincronizar ahora</button>
        </form>
      </section>

      {params.synced === "1" && (
        <p className="card status-ok">
          Recibos sincronizados correctamente · {String(params.count ?? "0")} leídos.
        </p>
      )}
      {typeof params.error === "string" && (
        <p className="card status-bad">{params.error}</p>
      )}

      <section className="grid receipt-kpis">
        <article className="card">
          <p className="eyebrow">HOY · VENTA NETA</p>
          <div className="metric">
            {money.format(
              validToday.reduce((sum, row) => sum + row.total, 0),
            )}
          </div>
          <p>{validToday.length} tickets válidos</p>
        </article>
        <article className="card">
          <p className="eyebrow">CANCELADOS HOY</p>
          <div className="metric">{cancelledToday.length}</div>
          <p>
            {money.format(
              cancelledToday.reduce((sum, row) => sum + row.total, 0),
            )} fuera de venta neta
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">ÚLTIMO SYNC</p>
          <div className="metric receipt-sync-time">
            {localDateTime(data.lastSyncedAt)}
          </div>
          <p>Últimos 120 recibos visibles</p>
        </article>
      </section>

      <section className="stack receipt-list">
        {data.rows.map((receipt) => (
          <details className="card receipt-row" key={receipt.externalId}>
            <summary>
              <div>
                <strong>{receipt.externalId}</strong>
                <span className="muted">
                  {localDateTime(receipt.receiptDate)}
                  {receipt.diningOption ? " · " + receipt.diningOption : ""}
                </span>
              </div>
              <div className="receipt-row-total">
                <span
                  className={
                    receipt.status === "VALID"
                      ? "status-ok"
                      : receipt.status === "CANCELLED"
                        ? "status-bad"
                        : "status-warn"
                  }
                >
                  {receipt.status === "VALID"
                    ? "VÁLIDO"
                    : receipt.status === "CANCELLED"
                      ? "CANCELADO"
                      : "REEMBOLSO"}
                </span>
                <strong>{money.format(receipt.total)}</strong>
              </div>
            </summary>

            <div className="receipt-audit-grid">
              <div>
                <span className="muted">Bruto</span>
                <strong>{money.format(receipt.gross)}</strong>
              </div>
              <div>
                <span className="muted">Descuento</span>
                <strong>{money.format(receipt.discount)}</strong>
              </div>
              <div>
                <span className="muted">Pago</span>
                <strong>
                  {receipt.payments.length
                    ? receipt.payments
                        .map(
                          (payment) =>
                            payment.name + " " + money.format(payment.amount),
                        )
                        .join(" + ")
                    : "—"}
                </strong>
              </div>
              <div>
                <span className="muted">Cliente</span>
                <strong>{receipt.customerName ?? "Sin identificar"}</strong>
              </div>
            </div>

            <div className="receipt-source-lines">
              {receipt.lines.map((line, index) => (
                <div key={receipt.externalId + "-" + index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <strong>{money.format(line.total)}</strong>
                </div>
              ))}
            </div>

            {receipt.cancelledAt && (
              <p className="status-bad">
                Cancelado: {localDateTime(receipt.cancelledAt)}
              </p>
            )}
          </details>
        ))}
      </section>
    </main>
  );
}
