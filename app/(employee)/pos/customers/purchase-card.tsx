import Link from "next/link";
import type { getCustomerPurchaseProfile } from "@/src/application/pos/customer-purchases";

type Profile = NonNullable<Awaited<ReturnType<typeof getCustomerPurchaseProfile>>>;
const money = new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
const when = (input: Date | null) => {
  if (!input) return "Sin datos";
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? "Sin datos" : new Intl.DateTimeFormat("es-MX",{
    timeZone:"America/Mexico_City",dateStyle:"medium",timeStyle:"short",
  }).format(date);
};

export function PurchaseCard({profile,customerId}:{profile:Profile;customerId:string}) {
  const s=profile.summary;
  return <section className="card stack">
    <p className="eyebrow">PERFIL COMERCIAL · COMPRAS VINCULADAS</p>
    <h2>Historial y preferencias</h2>
    <div className="grid cash-kpis">
      <article className="card"><p className="eyebrow">TICKETS</p><strong className="metric">{s.tickets}</strong></article>
      <article className="card"><p className="eyebrow">GASTO DOCUMENTADO</p><strong className="metric">{money.format(s.spent)}</strong></article>
      <article className="card"><p className="eyebrow">TICKET PROMEDIO</p><strong className="metric">{s.tickets?money.format(s.spent/s.tickets):"—"}</strong></article>
    </div>
    <p>Días con compra registrada: <strong>{s.distinctDays}</strong></p>
    <p>Primera compra documentada: {when(s.firstPurchase)}</p>
    <p>Última compra documentada: {when(s.lastPurchase)}</p>
    {profile.importedStats.totalVisits!=null &&
      <p>Visitas reportadas por Loyverse: <strong>{profile.importedStats.totalVisits}</strong></p>}
    {profile.importedStats.totalSpent!=null &&
      <p>Gasto histórico reportado por Loyverse: <strong>{money.format(profile.importedStats.totalSpent)}</strong></p>}
    <p className="muted">Los totales reportados por Loyverse pueden abarcar un periodo mayor que los recibos disponibles. No se adjudican tickets sin cliente identificado; una compra tampoco implica necesariamente una visita independiente.</p>
    <h3>Bebidas más compradas</h3>
    {profile.favoriteBeverages.length===0 && <p className="muted">No se identificaron bebidas en los tickets vinculados.</p>}
    {profile.favoriteBeverages.map((drink,i)=><div className="task" key={drink.name}>
      <strong>{i+1}. {drink.name}</strong>
      <span className="muted">{drink.units} unidades · {drink.tickets} tickets</span>
    </div>)}
    <p className="muted">La primera es la más comprada en el historial vinculado, no necesariamente la preferida declarada por el cliente.</p>
    <h3>Compras · página {profile.page}</h3>
    {profile.history.length===0 && <p className="muted">Todavía no hay tickets asociados.</p>}
    {profile.history.map((ticket)=><details key={ticket.source+":"+ticket.receipt_id} className="task">
      <summary><strong>{ticket.folio} · {money.format(Number(ticket.total))}</strong>
        <span className="muted"> · {when(ticket.occurred_at)} · {ticket.source}</span></summary>
      <div className="stack" style={{paddingTop:12}}>
        <p>Servicio: {ticket.service ?? "No indicado"}</p>
        {Array.isArray(ticket.lines) && ticket.lines.map((line:unknown,i:number)=>{
          if (!line || typeof line!=="object" || Array.isArray(line)) return null;
          const item=line as Record<string,unknown>;
          return <p className="muted" key={i}>{String(item.quantity ?? 1)} × {String(item.item_name ?? "Producto")}</p>;
        })}
        <Link href={ticket.source==="OPS" ? "/pos/receipt/"+ticket.receipt_id : "/pos/tickets?q="+encodeURIComponent(ticket.folio)}>Abrir ticket</Link>
      </div>
    </details>)}
    <div className="pos-result-actions">
      {profile.page>1 && <Link className="button" href={"?customer="+customerId+"&page="+(profile.page-1)}>← Anterior</Link>}
      {profile.hasMore && <Link className="button" href={"?customer="+customerId+"&page="+(profile.page+1)}>Siguiente →</Link>}
    </div>
  </section>;
}
