import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { PrintTicketButton } from "./print-button";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  employees,
  posCustomers,
  posOrderLines,
  posOrderSplitLines,
  posOrderSplits,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";
import { cancelPosOrder } from "../../actions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requestedSplitId =
    typeof query.split === "string" ? query.split : null;

  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const db = getDb();
  const [order] = await db
    .select({
      order: posOrders,
      employeeName: employees.name,
      customerName: posCustomers.name,
      customerPoints: posCustomers.pointsBalance,
    })
    .from(posOrders)
    .leftJoin(employees, eq(employees.id, posOrders.employeeId))
    .leftJoin(posCustomers, eq(posCustomers.id, posOrders.customerId))
    .where(
      and(
        eq(posOrders.id, id),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Ticket no encontrado");

  const split = requestedSplitId
    ? (
        await db
          .select()
          .from(posOrderSplits)
          .where(
            and(
              eq(posOrderSplits.id, requestedSplitId),
              eq(posOrderSplits.orderId, id),
              eq(
                posOrderSplits.organizationId,
                employee.organizationId,
              ),
            ),
          )
          .limit(1)
      )[0] ?? null
    : null;

  if (requestedSplitId && !split) {
    throw new Error("Cuenta dividida no encontrada");
  }

  const lines = split
    ? await db
        .select({
          id: posOrderSplitLines.id,
          quantity: posOrderSplitLines.quantity,
          nameSnapshot: posOrderLines.nameSnapshot,
          lineTotal: posOrderSplitLines.lineTotal,
          note: posOrderLines.note,
        })
        .from(posOrderSplitLines)
        .innerJoin(
          posOrderLines,
          eq(posOrderLines.id, posOrderSplitLines.orderLineId),
        )
        .where(eq(posOrderSplitLines.splitId, split.id))
    : await db
        .select({
          id: posOrderLines.id,
          quantity: posOrderLines.quantity,
          nameSnapshot: posOrderLines.nameSnapshot,
          lineTotal: posOrderLines.lineTotal,
          note: posOrderLines.note,
        })
        .from(posOrderLines)
        .where(eq(posOrderLines.orderId, id));

  const [payments, canCancel] = await Promise.all([
    db
      .select()
      .from(posPayments)
      .where(
        split
          ? and(
              eq(posPayments.orderId, id),
              eq(posPayments.splitId, split.id),
            )
          : and(
              eq(posPayments.orderId, id),
              isNull(posPayments.splitId),
            ),
      ),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
  ]);

  const ticketDate = (
    split?.paidAt ??
    order.order.paidAt ??
    order.order.createdAt
  ).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });

  const total = split ? Number(split.total) : Number(order.order.total);
  const paymentMethod = payments.map((payment) => payment.method).join(" + ");

  return (
    <main className="receipt-shell">
      <div className="receipt-toolbar no-print">
        <Link
          href={
            split
              ? "/pos/orders/" + id + "/split"
              : "/pos?saved=" + id
          }
          className="button"
        >
          Volver
        </Link>
        <PrintTicketButton />
      </div>

      <article className="receipt-paper">
        <header>
          <h1>Café Épico</h1>
          <p>Tepexi de Rodríguez, Puebla</p>
          <p>
            {split
              ? split.label + " · ticket separado"
              : "Ticket de prueba · POS espejo"}
          </p>
        </header>

        <div className="receipt-meta">
          <span>Folio</span>
          <span>{order.order.folio}</span>
          <span>Fecha</span>
          <span>{ticketDate}</span>
          <span>Atendió</span>
          <span>{order.employeeName ?? "Empleado"}</span>
          <span>Servicio</span>
          <span>
            {order.order.serviceMode === "TAKEAWAY"
              ? "Para llevar"
              : order.order.tableLabel || "Aquí"}
          </span>
        </div>

        <div className="receipt-lines">
          {lines.map((line) => (
            <div key={line.id} className="receipt-product">
              <div className="receipt-line">
                <span>
                  {Number(line.quantity)}× {line.nameSnapshot}
                </span>
                <span>{money.format(Number(line.lineTotal))}</span>
              </div>
              {line.note && (
                <div className="receipt-line-note">↳ {line.note}</div>
              )}
            </div>
          ))}
        </div>

        <div className="receipt-total">
          <span>TOTAL</span>
          <strong>{money.format(total)}</strong>
        </div>

        <div className="receipt-meta">
          <span>Pago</span>
          <span>{paymentMethod || "—"}</span>
          {order.customerName && (
            <>
              <span>Cliente</span>
              <span>{order.customerName}</span>
              {!split && (
                <>
                  <span>Saldo puntos</span>
                  <span>{Number(order.customerPoints ?? 0).toFixed(2)}</span>
                  <span>Generaría 5%</span>
                  <span>
                    +{Number(order.order.loyaltyPointsPreview).toFixed(2)}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {order.order.note && <p>Nota: {order.order.note}</p>}

        {order.order.status === "CANCELLED" && (
          <div className="receipt-cancelled">
            CANCELADO
            <br />
            {order.order.cancelReason ?? ""}
          </div>
        )}

        <footer>
          <p>Gracias por tu visita.</p>
          {!split && (
            <p>Puntos en simulación mientras POS esté en modo espejo.</p>
          )}
          <p>Documento de prueba interna · no es CFDI.</p>
        </footer>
      </article>

      {canCancel &&
        !split &&
        order.order.status !== "CANCELLED" && (
          <details className="card receipt-admin no-print">
            <summary>Cancelar ticket</summary>
            <form action={cancelPosOrder} className="stack">
              <input type="hidden" name="orderId" value={id} />
              <label>
                Motivo
                <input name="reason" required minLength={3} />
              </label>
              <button type="submit">Cancelar como administrador</button>
            </form>
          </details>
        )}
    </main>
  );
}
