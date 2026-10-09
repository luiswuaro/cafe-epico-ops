import Link from "next/link";
import { getTicketHistory, type TicketSource } from "@/src/application/pos/ticket-history";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN"});
const when = (date: Date | null) => date ? new Intl.DateTimeFormat("es-MX", {
  timeZone:"America/Mexico_City",dateStyle:"medium",timeStyle:"short",
}).format(new Date(date)) : "Sin fecha";

type Line = Record<string, unknown>;
function safeLines(input: unknown): Line[] {
  return Array.isArray(input)
    ? input.filter((item): item is Line => item != null && typeof item === "object" && !Array.isArray(item))
    : [];
}
function label(line: Line) {
  return String(line.name ?? line.item_name ?? "Producto");
}
function ticketLink(row: { source: string; id: string }) {
  return row.source === "OPS" ? "/pos/receipt/" + row.id : null;
}
export default async function TicketHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const source: TicketSource = input.source === "OPS" || input.source === "LOYVERSE"
    ? input.source : "TODOS";
  const q = typeof input.q === "string" ? input.q.slice(0, 80) : "";
  const day = typeof input.day === "string" ? input.day : "";
  const page = typeof input.page === "string" ? Number(input.page) || 1 : 1;

  const {employee} = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id, "pos.sell", employee.homeStoreId);
  const data = await getTicketHistory({
    organizationId:employee.organizationId,
    storeId:employee.homeStoreId,source,q,day,page,
  });
  function url(next: number) {
    const params = new URLSearchParams();
    if (q) params.set("q",q);
    if (day) params.set("day",day);
    if (source !== "TODOS") params.set("source",source);
    params.set("page",String(next));
    return "/pos/tickets?" + params.toString();
  }
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">POS · AUDITORÍA</p>
        <h1>Historial de tickets</h1>
        <p className="muted">Todos los tickets, independientemente del corte de caja. Incluye registros de Loyverse y OPS, identificados por origen.</p>
      </div>
      <Link href="/pos" className="button">Volver al POS</Link>
    </section>
    <section className="card stack">
      <form method="get" action="/pos/tickets" className="stack">
        <label>Buscar por folio, ID o cliente
          <input type="search" name="q" defaultValue={q} placeholder="Número de ticket o cliente" maxLength={80} />
        </label>
        <label>Fecha de venta (opcional)
          <input type="date" name="day" defaultValue={/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ""} />
        </label>
        <label>Origen
          <select name="source" defaultValue={source}>
            <option value="TODOS">Todos</option>
            <option value="LOYVERSE">Loyverse</option>
            <option value="OPS">OPS</option>
          </select>
        </label>
        <button type="submit">Aplicar filtros</button>
      </form>
      <p className="muted">
        Cada ticket conserva su origen. Una venta capturada tanto en OPS espejo como en Loyverse puede aparecer dos veces: no deben sumarse como dos ventas reales.
      </p>
    </section>
    <section className="card stack">
      <div className="section-heading">
        <h2>Tickets · página {data.page}</h2>
        <span className="pill">{data.tickets.length} registros</span>
      </div>
      {data.tickets.length === 0 && <p className="muted">Sin tickets para estos filtros.</p>}
      {data.tickets.map((row) => {
        const detail = safeLines(row.lines);
        const href = ticketLink(row);
        return <details key={row.source + ":" + row.id} className="task">
          <summary>
            <strong>{row.folio} · {money.format(Number(row.total))}</strong>
            <span className="muted"> · {row.source} · {when(row.occurred_at)} · {row.status === "CANCELLED" ? "Cancelado" : row.status}</span>
          </summary>
          <div className="stack" style={{paddingTop:12}}>
            <p>Origen: <strong>{row.source === "LOYVERSE" ? "Loyverse · histórico" : "OPS · " + row.mode}</strong></p>
            <p>Cliente: {row.customer || "Sin información"} · Pago: {row.payment || "Sin información"}</p>
            <p>Servicio: {row.service_mode || "No registrado"}</p>
            {row.source === "OPS" && <p>
              Inventario descontado: <strong>{row.inventory_effect_applied ? "Sí" : "No"}</strong> ·
              Puntos acreditados: <strong>{row.loyalty_effect_applied ? "Sí" : "No"}</strong>
            </p>}
            {row.cancel_reason && <p>Cancelación: {row.cancel_reason}</p>}
            <h3>Productos ({detail.length})</h3>
            {detail.map((line,i) => <p className="muted" key={i}>
              {String(line.quantity ?? 1)} × {label(line)}
              {line.total != null ? " · " + money.format(Number(line.total)) : ""}
              {line.note ? " · " + String(line.note) : ""}
            </p>)}
            {href && <Link href={href} className="button">Ver ticket OPS / imprimir</Link>}
          </div>
        </details>;
      })}
      <div className="pos-result-actions">
        {data.page > 1 && <Link href={url(data.page - 1)} className="button">← Página anterior</Link>}
        {data.hasNext && <Link href={url(data.page + 1)} className="button">Página siguiente →</Link>}
      </div>
    </section>
  </main>;
}
