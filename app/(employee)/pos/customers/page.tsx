import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getCustomerPurchaseProfile } from "@/src/application/pos/customer-purchases";
import { createPosCustomer } from "../actions";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { posLoyaltyEntries, posOrders } from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

const when = (date: Date) => new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
}).format(date);

export default async function CustomerLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const q = typeof input.q === "string" ? input.q.slice(0,80).trim() : "";
  const selectedId = typeof input.customer === "string" ? input.customer : "";
  const purchasePage = typeof input.page === "string" ? Number(input.page) || 1 : 1;

  const {employee} = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const all = await getPosCustomers(employee.organizationId);
  const selected = all.find((c)=>c.id===selectedId);
  const profile = selected ? await getCustomerPurchaseProfile({
    organizationId:employee.organizationId,storeId:employee.homeStoreId!,customerId:selected.id,page:purchasePage,
  }) : null;
  const filtered = all.filter((c) => {
    const s = (c.name+" "+(c.phone??"")+" "+(c.email??"")).toLocaleLowerCase("es-MX");
    return s.includes(q.toLocaleLowerCase("es-MX"));
  });
  const entries = selected
    ? await getDb().select({
        id:posLoyaltyEntries.id,
        points:posLoyaltyEntries.points,
        type:posLoyaltyEntries.entryType,
        note:posLoyaltyEntries.note,
        createdAt:posLoyaltyEntries.createdAt,
        orderFolio:posOrders.folio,
        orderId:posOrders.id,
      }).from(posLoyaltyEntries)
      .leftJoin(posOrders,eq(posOrders.id,posLoyaltyEntries.orderId))
      .where(and(eq(posLoyaltyEntries.organizationId,employee.organizationId),eq(posLoyaltyEntries.customerId,selected.id)))
      .orderBy(desc(posLoyaltyEntries.createdAt)).limit(200)
    : [];
  const ledgerSum = entries.reduce((n,e)=>n+Number(e.points),0);
  return <main className="shell pos-shell">
    <section className="hero pos-hero">
      <div>
        <p className="eyebrow">POS · CLIENTES</p>
        <h1>Clientes y puntos</h1>
        <p className="muted">Consulta saldos y movimientos acreditados. El 5% calculado en ventas espejo es una simulación, no abona puntos.</p>
      </div>
      <Link href="/pos" className="button">Volver al POS</Link>
    </section>
    <section className="card stack">
      <p className="eyebrow">REGISTRO</p>
      <h2>Agregar cliente</h2>
      <p className="muted">El cliente nuevo empieza con 0.00 puntos y regresa seleccionado al POS.</p>
      <form action={createPosCustomer} className="stack">
        <label>Nombre <input name="name" minLength={2} maxLength={150} required /></label>
        <label>Teléfono <input name="phone" type="tel" maxLength={30} placeholder="Opcional" /></label>
        <label>Correo <input name="email" type="email" maxLength={200} placeholder="Opcional" /></label>
        <button type="submit">Registrar cliente</button>
      </form>
    </section>
    <section className="card stack">
      <h2>Directorio ({all.length})</h2>
      <form method="get" action="/pos/customers" className="stack">
        <label>Buscar cliente
          <input name="q" type="search" defaultValue={q} placeholder="Nombre, teléfono o correo" maxLength={80} />
        </label>
        <button type="submit">Buscar</button>
      </form>
      {filtered.length===0 && <p className="muted">No hay coincidencias.</p>}
      {filtered.slice(0,150).map((customer) => (
        <Link key={customer.id} href={"/pos/customers?customer="+customer.id}
          className="task">
          <div style={{flex:1}}>
            <strong>{customer.name}</strong>
            <div className="muted">{customer.phone || customer.email || "Sin contacto"}</div>
          </div>
          <strong>{Number(customer.pointsBalance).toFixed(2)} pts</strong>
        </Link>
      ))}
    </section>
    {selected && <section className="card stack">
      <p className="eyebrow">ESTADO DE CUENTA</p>
      <h2>{selected.name}</h2>
      <strong className="metric">{Number(selected.pointsBalance).toFixed(2)} pts</strong>
      <p className="muted">Total de movimientos registrados: {entries.length}. Saldo según estos movimientos: {ledgerSum.toFixed(2)} pts.</p>
      {Math.abs(Number(selected.pointsBalance)-ledgerSum)>0.01 && <p className="status-warn">
        Atención: el saldo no coincide con los movimientos listados. Requiere auditoría (puede existir historial anterior a los 200 movimientos visibles).
      </p>}
      {entries.length===0 && <p className="muted">Aún sin movimientos de puntos acreditados.</p>}
      {entries.map((entry) => <div className="task" key={entry.id}>
        <div style={{flex:1}}>
          <strong>{entry.type==="MIGRATION"?"Saldo importado de Loyverse":entry.type}</strong>
          <div className="muted">{when(entry.createdAt)}{entry.note ? " · "+entry.note : ""}</div>
          {entry.orderId && <Link href={"/pos/receipt/"+entry.orderId}>Ticket {entry.orderFolio || entry.orderId}</Link>}
        </div>
        <strong>{Number(entry.points)>0?"+":""}{Number(entry.points).toFixed(2)} pts</strong>
      </div>)}
      <Link href={"/pos?customer="+selected.id} className="button">Seleccionar en POS</Link>
    </section>}
  </main>;
}
