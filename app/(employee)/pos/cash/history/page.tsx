import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { auditEvents, employees, posCashMovements, posCashSessions } from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const when = (date: Date | null) => date
  ? new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
    }).format(date)
  : "—";

const display = (value: string | number | null) =>
  value == null ? "Sin arqueo" : money.format(Number(value));

function auditData(value: Record<string, unknown> | null) {
  return value ?? {};
}

export default async function CashHistoryPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id, "pos.cash.manage", employee.homeStoreId);
  const db = getDb();
  const sessions = await db.select().from(posCashSessions).where(and(
    eq(posCashSessions.organizationId, employee.organizationId),
    eq(posCashSessions.storeId, employee.homeStoreId),
  )).orderBy(desc(posCashSessions.openedAt)).limit(100);

  const sessionIds = sessions.map((row) => row.id);
  const [movements, people, reconciliations] = await Promise.all([
    sessionIds.length
      ? db.select().from(posCashMovements).where(inArray(posCashMovements.sessionId, sessionIds))
        .orderBy(desc(posCashMovements.createdAt))
      : Promise.resolve([]),
    db.select({id: employees.id, name: employees.name}).from(employees).where(
      eq(employees.organizationId, employee.organizationId),
    ),
    db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, employee.organizationId),
      eq(auditEvents.storeId, employee.homeStoreId),
      eq(auditEvents.action, "LOYVERSE_DAILY_CASH_RECONCILIATION"),
    )).orderBy(desc(auditEvents.createdAt)).limit(100),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · AUDITORÍA</p>
          <h1>Historial de cajas</h1>
          <p className="muted">Cortes, movimientos y conciliaciones. Los cierres administrativos no equivalen a arqueos físicos.</p>
        </div>
        <Link href="/pos/cash" className="button">Volver a caja</Link>
      </section>
      <section className="card stack">
        <p className="eyebrow">SESIONES OPS</p>
        <h2>Últimas {sessions.length} cajas</h2>
        {sessions.length === 0 && <p className="muted">Aún no hay sesiones registradas.</p>}
        {sessions.map((session) => {
          const entries = movements.filter((m) => m.sessionId === session.id);
          const subtotal = (type: string) => entries.filter((m) => m.movementType === type)
            .reduce((sum,m) => sum + Number(m.amount), 0);
          return (
            <details key={session.id} className="task">
              <summary>
                <strong>{when(session.openedAt)} · {session.status === "OPEN" ? "Abierta" : session.countedCash == null ? "Cierre administrativo" : "Cerrada"}</strong>
                <span className="muted"> · Esperado {session.expectedCashSnapshot == null ? money.format(Number(session.openingCash) + entries.reduce((sum,m) => sum + Number(m.amount),0)) : money.format(Number(session.expectedCashSnapshot))}</span>
              </summary>
              <div className="stack" style={{paddingTop: 16}}>
                <p>Abrió: {names.get(session.openedByEmployeeId ?? "") ?? "No identificado"} · {when(session.openedAt)}</p>
                <p>Cerró: {names.get(session.closedByEmployeeId ?? "") ?? "No identificado"} · {when(session.closedAt)}</p>
                <p>Fondo inicial: <strong>{money.format(Number(session.openingCash))}</strong></p>
                <p>Ventas efectivo: {money.format(subtotal("SALE"))} · Entradas: {money.format(subtotal("CASH_IN"))} · Salidas: {money.format(Math.abs(subtotal("CASH_OUT")))} · Reembolsos: {money.format(Math.abs(subtotal("REFUND")))}</p>
                <p>Contado: <strong>{display(session.countedCash)}</strong> · Diferencia: <strong>{session.difference == null ? "No determinada" : money.format(Number(session.difference))}</strong></p>
                {session.closingNote && <p>Nota: {session.closingNote}</p>}
                <h3>Movimientos ({entries.length})</h3>
                {entries.length === 0 && <p className="muted">Sin movimientos registrados.</p>}
                {entries.map((m) => <p key={m.id} className="muted">
                  {when(m.createdAt)} · {m.movementType} · {money.format(Number(m.amount))}
                  {m.orderId ? " · Pedido " + m.orderId.slice(0,8) : ""}
                  {m.note ? " · " + m.note : ""}
                </p>)}
              </div>
            </details>
          );
        })}
      </section>
      <section className="card stack">
        <p className="eyebrow">LOYVERSE · IMPORTACIONES</p>
        <h2>Conciliaciones históricas ({reconciliations.length})</h2>
        <p className="muted">Son registros de auditoría, no sesiones operativas OPS. Un conteo informado por el propietario se distingue de un arqueo realizado en OPS.</p>
        {reconciliations.length === 0 && <p className="muted">Sin conciliaciones históricas.</p>}
        {reconciliations.map((r) => {
          const data = auditData(r.afterData);
          const receipts = Array.isArray(data.receipts) ? data.receipts : [];
          return <details key={r.id} className="task">
            <summary><strong>{String(data.business_date ?? when(r.createdAt))}</strong> · {String(data.receipt_count ?? 0)} recibos · {money.format(Number(data.cash_payments ?? 0))}</summary>
            <div className="stack" style={{paddingTop:16}}>
              <p>Fondo reportado: {display(Number(data.opening_cash_owner_reported ?? 0))} · Efectivo esperado: {display(Number(data.expected_cash ?? 0))}</p>
              <p>Efectivo físico reportado: {data.physical_cash_owner_reported == null ? "No registrado" : display(Number(data.physical_cash_owner_reported))} · Diferencia: {data.difference == null ? "No determinada" : display(Number(data.difference))}</p>
              <p>Recibos: {receipts.join(", ") || "No detallados"}</p>
              <p className="muted">{String(data.notes ?? "")}</p>
            </div>
          </details>;
        })}
      </section>
    </main>
  );
}
