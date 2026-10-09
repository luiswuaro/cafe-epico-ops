import Image from "next/image";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { DirectPrintTicketButton } from "./direct-print-button";
import { PrintTicketButton } from "./print-button";
import { getPosPrintSettings } from "@/src/application/pos/print-settings";
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
  const [order, printSettings] = await Promise.all([
    db
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
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getPosPrintSettings(employee.organizationId),
  ]);

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
  const cashPayment = payments.find((payment) => payment.method === "CASH");
  const cashTendered = cashPayment?.tenderedAmount
    ? money.format(Number(cashPayment.tenderedAmount))
    : null;
  const cashChange = cashPayment?.changeAmount
    ? money.format(Number(cashPayment.changeAmount))
    : null;
  const pointsEarned =
    !split &&
    order.customerName &&
    order.order.loyaltyEffectApplied
      ? Number(order.order.loyaltyPointsPreview).toFixed(2)
      : null;
  const pointsBalance =
    !split && order.customerName
      ? Number(order.customerPoints ?? 0).toFixed(2)
      : null;

  const service =
    order.order.serviceMode === "TAKEAWAY"
      ? "Para llevar"
      : order.order.tableLabel || "Aquí";

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

        <DirectPrintTicketButton
          ticket={{
            folio: order.order.folio,
            date: ticketDate,
            employee: order.employeeName ?? "Empleado",
            service,
            splitLabel: split?.label ?? null,
            items: lines.map((line) => ({
              quantity: Number(line.quantity),
              name: line.nameSnapshot,
              note: line.note,
              total: money.format(Number(line.lineTotal)),
            })),
            total: money.format(total),
            payment: paymentMethod || "-",
            cashTendered,
            cashChange,
            customer: order.customerName,
            pointsEarned,
            pointsBalance,
          }}
          template={{
            businessName: printSettings.businessName,
            addressLine: printSettings.addressLine,
            phoneLine: printSettings.phoneLine,
            socialLine: printSettings.socialLine,
            headerMessage: printSettings.headerMessage,
            footerMessage: printSettings.footerMessage,
            showLogo: printSettings.showLogo,
            logoRasterBase64: printSettings.logoRasterBase64,
            logoWidthPx: printSettings.logoWidthPx,
            logoHeightPx: printSettings.logoHeightPx,
            logoAlign: printSettings.logoAlign,
            showBusinessName: printSettings.showBusinessName,
            showAddress: printSettings.showAddress,
            showPhone: printSettings.showPhone,
            showSocial: printSettings.showSocial,
            showFolio: printSettings.showFolio,
            showDate: printSettings.showDate,
            showEmployee: printSettings.showEmployee,
            showService: printSettings.showService,
            showCustomer: printSettings.showCustomer,
            showPoints: printSettings.showPoints,
            showItemNotes: printSettings.showItemNotes,
            showNoCfdi: printSettings.showNoCfdi,
            lineWidthChars: printSettings.lineWidthChars,
            feedLines: printSettings.feedLines,
            autoCut: printSettings.autoCut,
          }}
        />

        <PrintTicketButton />
      </div>

      <article className="receipt-paper">
        <header>
          {printSettings.showLogo &&
            printSettings.logoDataUrl &&
            printSettings.logoWidthPx &&
            printSettings.logoHeightPx && (
              <div
                className={
                  "receipt-logo receipt-logo-" + printSettings.logoAlign
                }
              >
                <Image
                  src={printSettings.logoDataUrl}
                  alt="Logo Café Épico"
                  width={printSettings.logoWidthPx}
                  height={printSettings.logoHeightPx}
                  unoptimized
                />
              </div>
            )}

          {printSettings.showBusinessName && (
            <h1>{printSettings.businessName}</h1>
          )}
          {printSettings.showAddress && printSettings.addressLine && (
            <p>{printSettings.addressLine}</p>
          )}
          {printSettings.showPhone && printSettings.phoneLine && (
            <p>{printSettings.phoneLine}</p>
          )}
          {printSettings.showSocial && printSettings.socialLine && (
            <p>{printSettings.socialLine}</p>
          )}
          {printSettings.headerMessage && (
            <p>{printSettings.headerMessage}</p>
          )}
          {split && <p><strong>{split.label} · ticket separado</strong></p>}
        </header>

        {(printSettings.showFolio ||
          printSettings.showDate ||
          printSettings.showEmployee ||
          printSettings.showService) && (
          <div className="receipt-meta">
            {printSettings.showFolio && (
              <>
                <span>Folio</span>
                <span>{order.order.folio}</span>
              </>
            )}
            {printSettings.showDate && (
              <>
                <span>Fecha</span>
                <span>{ticketDate}</span>
              </>
            )}
            {printSettings.showEmployee && (
              <>
                <span>Atendió</span>
                <span>{order.employeeName ?? "Empleado"}</span>
              </>
            )}
            {printSettings.showService && (
              <>
                <span>Servicio</span>
                <span>{service}</span>
              </>
            )}
          </div>
        )}

        <div className="receipt-lines">
          {lines.map((line) => (
            <div key={line.id} className="receipt-product">
              <div className="receipt-line">
                <span>
                  {Number(line.quantity)}× {line.nameSnapshot}
                </span>
                <span>{money.format(Number(line.lineTotal))}</span>
              </div>
              {printSettings.showItemNotes && line.note && (
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

          {cashTendered && cashChange && (
            <>
              <span>Recibido</span>
              <span>{cashTendered}</span>
              <span>Cambio</span>
              <span><strong>{cashChange}</strong></span>
            </>
          )}

          {printSettings.showCustomer && order.customerName && (
            <>
              <span>Cliente</span>
              <span>{order.customerName}</span>
            </>
          )}

          {printSettings.showPoints && pointsBalance && pointsEarned && (
            <>
              <span>Puntos ganados</span>
              <span>+{pointsEarned}</span>
              <span>Saldo puntos</span>
              <span>{pointsBalance}</span>
            </>
          )}
        </div>

        {order.order.note && <p>Nota de orden: {order.order.note}</p>}

        {order.order.status === "CANCELLED" && (
          <div className="receipt-cancelled">
            CANCELADO
            <br />
            {order.order.cancelReason ?? ""}
          </div>
        )}

        <footer>
          {printSettings.footerMessage && (
            <p><strong>{printSettings.footerMessage}</strong></p>
          )}
          {printSettings.showNoCfdi && <p>Este ticket no es CFDI.</p>}
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
