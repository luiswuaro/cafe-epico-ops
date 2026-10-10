import {randomUUID} from "node:crypto";
import {deliverExtraPackaging} from "./packaging-action";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { DirectPrintTicketButton } from "./direct-print-button";
import { PrintTicketButton } from "./print-button";
import { AutoKitchenPrint } from "../../orders/auto-kitchen-print";
import { getPosPrintSettings } from "@/src/application/pos/print-settings";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  employees,
  posCustomers,
  posLoyaltyEntries,
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
  const cancelError=typeof query.cancelError==="string"?query.cancelError.slice(0,300):null;
  const packagingError=typeof query.packagingError==="string"?query.packagingError.slice(0,300):null;
  const packagingDone=query.packaged==="1";

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
  // La precuenta y el comprobante final no pueden confundirse: una
  // comanda abierta o un split pendiente jamás imprimen un recibo pagado.
  if (order.order.status!=="CANCELLED" &&
      (split ? split.status!=="PAID" : order.order.status!=="PAID")) {
    redirect("/pos/orders/"+id+"/prebill"+(split?"?split="+split.id:""));
  }

  const lines = split
    ? await db
        .select({
          id: posOrderSplitLines.id,
          quantity: posOrderSplitLines.quantity,
          nameSnapshot: posOrderLines.nameSnapshot,
          categorySnapshot:posOrderLines.categorySnapshot,
          lineTotal: posOrderSplitLines.lineTotal,
          note: posOrderLines.note,
          expectedConsumption: posOrderLines.expectedConsumption,
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
          categorySnapshot:posOrderLines.categorySnapshot,
          lineTotal: posOrderLines.lineTotal,
          note: posOrderLines.note,
          expectedConsumption: posOrderLines.expectedConsumption,
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
          : eq(posPayments.orderId, id),
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
  const paymentMethod = [...new Set(payments.map((payment) => payment.method))].join(" + ");
  const paidAmount=payments.reduce((sum,payment)=>sum+Number(payment.amount),0);
  const loyalty=await db.select({
    customerId:posLoyaltyEntries.customerId,
    name:posCustomers.name,
    balance:posCustomers.pointsBalance,
    points:posLoyaltyEntries.points,
    note:posLoyaltyEntries.note,
  }).from(posLoyaltyEntries)
    .innerJoin(posCustomers,eq(posLoyaltyEntries.customerId,posCustomers.id))
    .where(and(
      eq(posLoyaltyEntries.orderId,id),
      eq(posLoyaltyEntries.entryType,"EARN"),
    ));
  const applicable=split
    ? loyalty.filter(row=>row.note?.startsWith(split.label+" · "))
    : loyalty;
  const recipients=new Set(applicable.map(row=>row.customerId));
  const receiptCustomer=recipients.size===1
    ? applicable[0].name
    : recipients.size>1?"Varios clientes":split?null:order.customerName;
  const pointsEarned=order.order.status!=="CANCELLED"&&applicable.length
    ? applicable.reduce((sum,row)=>sum+Number(row.points),0).toFixed(2):null;
  const pointsBalance=order.order.status!=="CANCELLED"&&recipients.size===1
    ? Number(applicable[0].balance).toFixed(2):null;

  const extraEvents=order.order.mode==="LIVE"&&order.order.status==="PAID"&&!split
    ?await db.select({data:auditEvents.afterData}).from(auditEvents).where(and(
      eq(auditEvents.organizationId,employee.organizationId),
      eq(auditEvents.action,"POS_EXTRA_TAKEAWAY_PACKAGING"),
      eq(auditEvents.entityId,id),
    )):[];
  const packagedUnits=(lineId:string)=>extraEvents
    .filter(event=>event.data?.lineId===lineId)
    .reduce((sum,event)=>sum+Number(event.data?.quantity??0),0);

  const service = order.order.tableLabel ||
    (order.order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí");

  return (
    <main className="receipt-shell">
      {query.autoKitchen==="paid"&&
        order.order.mode==="LIVE"&&
        order.order.status==="PAID"&&
        (!split||split.status==="PAID")&&
        <AutoKitchenPrint event="paid"
          eventId={order.order.id+(split?"-"+split.id:"")}
          slip={{
            folio:order.order.folio,
            table:order.order.tableLabel||
              (order.order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí"),
            orderNote:order.order.note,
            lines:lines.map(line=>({
              id:line.id,name:line.nameSnapshot,category:line.categorySnapshot,
              quantity:Number(line.quantity),note:line.note,
              serviceMode:typeof line.expectedConsumption?.serviceMode==="string"
                ?line.expectedConsumption.serviceMode:order.order.serviceMode,
              roundId:typeof line.expectedConsumption?.roundId==="string"
                ?line.expectedConsumption.roundId:null,
            })),
          }}
        />}

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
            kind: "RECEIPT",
            status: order.order.status,
            cancelReason: order.order.cancelReason,
            date: ticketDate,
            employee: order.employeeName ?? "Empleado",
            service,
            splitLabel: split?.label ?? null,
            items: lines.map((line) => ({
              quantity: Number(line.quantity),
              name: line.nameSnapshot,
              note: (line.expectedConsumption?.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí")+
                (line.note?" · "+line.note:""),
              total: money.format(Number(line.lineTotal)),
            })),
            total: money.format(total),
            payment: paymentMethod || "-",
            customer: receiptCustomer,
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
        {!split&&order.order.mode==="LIVE"&&order.order.status==="PAID"&&
          lines.some(line=>line.expectedConsumption?.serviceMode==="DINE_IN")&&
          <a className="button receipt-extra-shortcut" href="#empaque-para-llevar">
            <span aria-hidden="true">↗</span> Vaso para llevar
          </a>}
      </div>

      {!split&&order.order.status==="PARTIALLY_PAID"&&<section className="card no-print" role="status">
        <p className="status-warn">Mesa parcialmente pagada · {money.format(paidAmount)} de {money.format(Number(order.order.total))} registrados.</p>
        <p className="muted">No imprimas el total como venta liquidada. Continúa desde las cuentas pendientes.</p>
        <Link className="button" href={"/pos/orders/"+id+"/split"}>Terminar cuentas pendientes</Link>
      </section>}
      {cancelError&&<section className="card no-print" role="alert">
        <p className="status-bad">Cancelación no confirmada: {cancelError}</p>
        <p className="muted">El ticket sigue disponible para revisión. Verifica pagos, caja e inventario antes de volver a intentar.</p>
      </section>}
      {packagingError&&<section className="card no-print" role="alert">
        <p className="status-bad">No se entregó el envase: {packagingError}</p>
      </section>}
      {packagingDone&&<section className="card no-print" role="status">
        <p className="status-ok">Envase adicional registrado en inventario y auditoría, sin nuevo cobro.</p>
      </section>}
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
          <p className="receipt-document-type">
            {order.order.status==="CANCELLED"?"TICKET CANCELADO":"TICKET DE VENTA · PAGADO"}
          </p>
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
              <div className="receipt-line-note">
                {line.expectedConsumption?.serviceMode==="TAKEAWAY"?"Para llevar":"Para consumir aquí"}
              </div>
              {printSettings.showItemNotes && line.note && (
                <div className="receipt-line-note">↳ {line.note}</div>
              )}
            </div>
          ))}
        </div>

        <div className="receipt-total">
          <span>{order.order.status === "CANCELLED" ? "TOTAL ORIGINAL" : "TOTAL"}</span>
          <strong>{money.format(total)}</strong>
        </div>

        <div className="receipt-meta">
          <span>{order.order.status === "CANCELLED" ? "Pago original" : "Pago"}</span>
          <span>{paymentMethod || "—"}</span>

          {printSettings.showCustomer && receiptCustomer && (
            <>
              <span>Cliente</span>
              <span>{receiptCustomer}</span>
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
            CANCELADO · SIN VENTA ACTIVA
            <br />
            {order.order.cancelReason ?? ""}
            <p>Consultar reversas en Caja y Auditoría de inventario</p>
          </div>
        )}

        <footer>
          {printSettings.footerMessage && (
            <p><strong>{printSettings.footerMessage}</strong></p>
          )}
          {!split && order.order.mode === "SHADOW" && (
            <p>Orden en modo espejo. Puntos no acreditados en OPS.</p>
          )}
          {printSettings.showNoCfdi && <p>Este ticket no es CFDI.</p>}
        </footer>
      </article>

      {split&&order.order.status==="PAID"&&<div className="no-print receipt-toolbar">
        <Link className="button" href={"/pos/receipt/"+id}>Ver ticket completo y opciones de empaque</Link>
      </div>}
      {!split&&order.order.mode==="LIVE"&&order.order.status==="PAID"&&
        lines.some(line=>line.expectedConsumption?.serviceMode==="DINE_IN")&&
        <section id="empaque-para-llevar" className="card no-print receipt-extra-packaging" aria-labelledby="receipt-packaging-title">
          <div className="receipt-extra-header">
            <div>
              <p className="eyebrow">AJUSTE DE SERVICIO · POSTVENTA</p>
              <h2 id="receipt-packaging-title">Entregar vaso para llevar</h2>
            </div>
            <span className="pill">Sin cobrar otra bebida</span>
          </div>
          <p className="muted receipt-extra-description">
            Si el cliente no terminó su bebida, selecciona cuál desea llevar.
            OPS registra únicamente el vaso, la tapa y los accesorios adicionales de la receta para llevar.
            La venta y el consumo de café originales se conservan.
          </p>
          <div className="receipt-extra-list">
            {lines.filter(line=>line.expectedConsumption?.serviceMode==="DINE_IN").map((line,index)=>{
              const remaining=Number(line.quantity)-packagedUnits(line.id);
              return <div key={line.id} className="receipt-packaging-line">
                <div className="receipt-packaging-product">
                  <span className="receipt-packaging-index">{index+1}</span>
                  <div>
                    <strong>{line.nameSnapshot}</strong>
                    <p className="muted">
                      {remaining>0
                        ?remaining+" bebida(s) con empaque disponible"
                        :"Empaque adicional ya registrado"}
                    </p>
                  </div>
                </div>
                {remaining>0
                  ?<form action={deliverExtraPackaging} className="receipt-packaging-form">
                    <input type="hidden" name="orderId" value={id}/>
                    <input type="hidden" name="lineId" value={line.id}/>
                    <input type="hidden" name="requestId" value={randomUUID()}/>
                    <label>Cantidad
                      <input type="number" name="quantity" min="1" max={remaining} defaultValue="1" step="1" required/>
                    </label>
                    <button type="submit">Registrar empaque</button>
                  </form>
                  :<span className="receipt-packaging-complete">Registrado ✓</span>}
              </div>;
            })}
          </div>
          <p className="receipt-packaging-footnote">No modifica el precio, los puntos ni las cantidades de ingredientes vendidos.</p>
        </section>}
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
