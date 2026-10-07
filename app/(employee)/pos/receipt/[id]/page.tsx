import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { PrintTicketButton } from "./print-button";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  employees,
  posOrderLines,
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    })
    .from(posOrders)
    .leftJoin(employees, eq(employees.id, posOrders.employeeId))
    .where(
      and(
        eq(posOrders.id, id),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Ticket no encontrado");

  const [lines, payments, canCancel] = await Promise.all([
    db
      .select()
      .from(posOrderLines)
      .where(eq(posOrderLines.orderId, id)),
    db
      .select()
      .from(posPayments)
      .where(eq(posPayments.orderId, id)),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
  ]);

  const paidAt = order.order.paidAt.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <main className="receipt-shell">
      <div className="receipt-toolbar no-print">
        <Link href={"/pos?saved=" + id} className="button">
          Volver al POS
        </Link>
        <PrintTicketButton />
      </div>

      <article className="receipt-paper">
        <header>
          <h1>Café Épico</h1>
          <p>Tepexi de Rodríguez, Puebla</p>
          <p>Ticket de prueba · POS espejo</p>
        </header>

        <div className="receipt-meta">
          <span>{order.order.folio}</span>
          <span>{paidAt}</span>
          <span>{order.employeeName ?? "Empleado"}</span>
          <span>
            {order.order.serviceMode === "TAKEAWAY"
              ? "Para llevar"
              : order.order.tableLabel || "Aquí"}
          </span>
        </div>

        <div className="receipt-lines">
          {lines.map((line) => (
            <div key={line.id} className="receipt-line">
              <span>
                {Number(line.quantity)}× {line.nameSnapshot}
              </span>
              <span>{money.format(Number(line.lineTotal))}</span>
            </div>
          ))}
        </div>

        <div className="receipt-total">
          <span>TOTAL</span>
          <strong>{money.format(Number(order.order.total))}</strong>
        </div>

        <div className="receipt-meta">
          <span>Pago</span>
          <span>{payments[0]?.method ?? "—"}</span>
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
          <p>Documento de prueba interna · no es CFDI.</p>
        </footer>
      </article>

      {canCancel && order.order.status !== "CANCELLED" && (
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
