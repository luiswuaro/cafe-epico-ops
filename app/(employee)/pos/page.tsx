import Link from "next/link";
import {and,eq,or,isNull,asc} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {employees,posStaffDrinks} from "@/src/infrastructure/db/schema";
import {extraLabels,preparationNote} from "@/src/application/pos/extras";
import {getPosExtraCatalog} from "@/src/application/pos/extra-catalog";
import { PosClient } from "./pos-client";
import { AutoKitchenPrint } from "./orders/auto-kitchen-print";
import { kitchenOrderIdentity } from "@/src/application/pos/kitchen-slip";
import { getShadowOrderMirror } from "@/src/application/pos/mirror";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { isPosLiveEnabled } from "@/src/application/pos/live";
import { getCashState } from "@/src/application/pos/cash";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getOpenPosOrders } from "@/src/application/pos/orders";

import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";
import { cancelPosOrder, refreshShadowMirror } from "./actions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const liveEnabled = isPosLiveEnabled();
  const pilotItem = liveEnabled ? process.env.POS_LIVE_PILOT_ITEM?.trim() : undefined;
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const payError = typeof params.error === "string" ? params.error.slice(0,260) : null;
  const savedId = typeof params.saved === "string" ? params.saved : null;
  const selectedTicketId = typeof params.ticket === "string" ? params.ticket : null;
  const selectedCustomerId =
    typeof params.customer === "string" ? params.customer : null;

  const today=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(new Date());
  const [catalog, customers, saved, canCancel, cash, openOrders, extrasOptions,activeWorkers,usedStaffDrinks] = await Promise.all([
    getPosCatalog(employee.organizationId),
    getPosCustomers(employee.organizationId),
    savedId
      ? getShadowOrderMirror(employee.organizationId, savedId)
      : Promise.resolve(null),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
    getCashState(employee.organizationId, employee.homeStoreId),
    getOpenPosOrders(employee.organizationId,employee.homeStoreId),
    getPosExtraCatalog(employee.organizationId),
    getDb().select({id:employees.id,name:employees.name}).from(employees)
      .where(and(eq(employees.organizationId,employee.organizationId),
        eq(employees.isActive,true),
        or(eq(employees.homeStoreId,employee.homeStoreId),isNull(employees.homeStoreId),eq(employees.id,employee.id))))
      .orderBy(asc(employees.name)),
    liveEnabled?getDb().select({beneficiaryEmployeeId:posStaffDrinks.beneficiaryEmployeeId})
      .from(posStaffDrinks).where(and(
        eq(posStaffDrinks.organizationId,employee.organizationId),
        eq(posStaffDrinks.businessDate,today),
      )):Promise.resolve([]),
  ]);
  const liveTickets=openOrders.filter(order=>order.mode==="LIVE");
  const selectedTicket=liveEnabled&&selectedTicketId
    ? liveTickets.find(order=>order.id===selectedTicketId)??null : null;

  return (
    <main className="shell pos-shell">
      {params.autoKitchen==="saved"&&selectedTicket&&
       typeof params.savedRound==="string"&&
       selectedTicket.lines.some(line=>line.expectedConsumption?.roundId===params.savedRound)&&
       <AutoKitchenPrint
         orderId={selectedTicket.id}
         event="saved"
         eventId={selectedTicket.id+":"+params.savedRound}
         roundId={params.savedRound}
         slip={{
           folio:selectedTicket.folio,
           ...kitchenOrderIdentity({ticketLabel:selectedTicket.tableLabel,customerName:selectedTicket.customerName,folio:selectedTicket.folio}),
           orderNote:selectedTicket.note,
           lines:selectedTicket.lines.map(line=>({
             id:line.id,name:line.name,category:line.category,
             quantity:Number(line.quantity),note:preparationNote(line.note,line.expectedConsumption),
             serviceMode:typeof line.expectedConsumption?.serviceMode==="string"
               ?line.expectedConsumption.serviceMode:null,
             roundId:typeof line.expectedConsumption?.roundId==="string"
               ?line.expectedConsumption.roundId:null,
           })),
         }}
       />}

      {process.env.VERCEL_ENV==="preview"&&<div className="card status-warn" role="status">
        PREVIEW DE OPS · SOLO LECTURA. Las ventas, comandas, caja y ajustes de inventario están desactivados para proteger la base de producción.
      </div>}
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">{liveEnabled ? "POS · LIVE" : "POS V0.1 · MODO ESPEJO"}</p>
          <h1>Tomar orden</h1>
          <p><Link href="/inventory/ops">Consultar inventario OPS y registrar reabastos</Link> · <Link href="/pos/launch-check">Validación para activar POS LIVE</Link></p>
          {pilotItem && <p className="status-warn">
            PILOTO LIVE · Únicamente {pilotItem}. Cada cobro sí modificará inventario, caja y puntos reales de OPS.
          </p>}
          <p className="muted">
            {liveEnabled
              ? "Venta continua: descuenta insumos incluso si su saldo teórico es insuficiente. Los faltantes se registran para reabasto."
              : "Registra la misma venta que acabas de cobrar en Loyverse. En esta etapa OPS captura un espejo sin descontar insumos ni acreditar puntos."}
          </p>
        </div>
        <span className="status-warn">{liveEnabled ? "VENTA LIVE · SIN BLOQUEO POR STOCK" : "NO CONTABILIZA INVENTARIO"}</span>
      </section>

      {payError && <section className="card"><p className="status-bad" role="alert">No se registró el cobro: {payError}</p></section>}

      {saved && (
        <section
          className={
            saved.mirror?.exact
              ? "card pos-mirror-result pos-mirror-ok"
              : "card pos-mirror-result"
          }
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">{saved.order.mode === "LIVE" ? "VENTA OPS LIVE" : "VENTA ESPEJO"} · {saved.order.folio}</p>
              <h2>
                {saved.order.status === "CANCELLED"
                  ? "Venta cancelada"
                  : saved.order.mode === "LIVE"
                    ? "Cobro LIVE registrado en OPS"
                    : saved.mirror?.exact
                      ? "Espejo exacto encontrado"
                      : saved.mirror
                        ? "Encontré una venta para revisar"
                        : "OPS guardó la venta; falta encontrar su espejo"}
              </h2>
            </div>
            <strong className="metric">{money.format(Number(saved.order.total))}</strong>
          </div>

          {saved.order.mode === "LIVE" ? (
            <div className="stack compact-stack">
              <p className={saved.order.status === "CANCELLED" ? "status-warn" : "status-ok"}>
                {saved.order.status === "CANCELLED"
                  ? "Venta LIVE cancelada. Se conservaron folio, pago y movimientos de reversa para auditoría."
                  : "Venta cobrada directamente en OPS. No requiere sincronizar ni buscar un recibo de Loyverse."}
              </p>
              <p className="muted">
                Método de pago: {saved.payment?.method === "CASH" ? "Efectivo" :
                  saved.payment?.method === "CARD" ? "Tarjeta" :
                  saved.payment?.method === "TRANSFER" ? "Transferencia" : "No registrado"}
                {" · "}Servicio: {saved.order.serviceMode === "DINE_IN" ? "Aquí" : "Para llevar"}
                {" · "}Inventario: {saved.order.inventoryEffectApplied ? "Descontado" : "Sin descuento activo"}
              </p>
            </div>
          ) : saved.mirror ? (
            <div className="pos-mirror-grid">
              <div>
                <span className="muted">Recibo Loyverse</span>
                <strong>{saved.mirror.externalId}</strong>
              </div>
              <div>
                <span className="muted">Total</span>
                <strong>
                  {saved.mirror.totalDiff <= 0.01 ? "✓ Coincide" : "Revisar"}
                </strong>
              </div>
              <div>
                <span className="muted">Productos</span>
                <strong>{saved.mirror.linesExact ? "✓ Coinciden" : "Revisar"}</strong>
              </div>
              <div>
                <span className="muted">Servicio</span>
                <strong>
                  {saved.mirror.serviceModeExact ? "✓ Coincide" : "Revisar"}
                </strong>
              </div>
              <div>
                <span className="muted">Pago</span>
                <strong>{saved.mirror.paymentExact ? "✓ Coincide" : "Revisar"}</strong>
              </div>
              <div>
                <span className="muted">Diferencia de tiempo</span>
                <strong>
                  {saved.mirror.timeDeltaSeconds == null
                    ? "—"
                    : Math.abs(saved.mirror.timeDeltaSeconds) + " s"}
                </strong>
              </div>
            </div>
          ) : (
            <div className="stack compact-stack">
              <p className="muted">
                La venta todavía no está en el espejo local de Loyverse.
                Puedes traer los recibos recientes y volver a comparar ahora.
              </p>
              <form action={refreshShadowMirror}>
                <input type="hidden" name="orderId" value={saved.order.id} />
                <button type="submit">
                  Sincronizar Loyverse y comparar
                </button>
              </form>
            </div>
          )}

          <div className="pos-saved-lines">
            {saved.lines.map((line) => (
              <span key={line.id}>
                {Number(line.quantity)}× {line.nameSnapshot}
              </span>
            ))}
          </div>
          <div className="pos-result-actions">
            <Link href={"/pos/receipt/" + saved.order.id} className="button">
              Imprimir ticket
            </Link>
            <Link href="/pos" className="button">
              {saved.order.mode === "LIVE" ? "Nueva orden" : "Nueva orden espejo"}
            </Link>
          </div>

          {canCancel && saved.order.status !== "CANCELLED" && (
            <details className="pos-cancel-panel">
              <summary>Cancelar ticket</summary>
              <form action={cancelPosOrder} className="stack">
                <input type="hidden" name="orderId" value={saved.order.id} />
                <label>
                  Motivo
                  <input
                    name="reason"
                    required
                    minLength={3}
                    placeholder="Ej. captura duplicada"
                  />
                </label>
                <button type="submit">Cancelar como administrador</button>
              </form>
            </details>
          )}

          {saved.order.status === "CANCELLED" && (
            <p className="status-bad">
              CANCELADO · {saved.order.cancelReason ?? "Sin motivo"}
            </p>
          )}
        </section>
      )}

      {liveEnabled&&<section className="pos-fast-tickets" aria-label="Mesas y tickets activos">
        <strong>Mesas abiertas <span className="pill">{liveTickets.length}</span></strong>
        <div className="pos-fast-tickets-scroll">
          {liveTickets.slice(0,8).map(ticket=><Link key={ticket.id}
            href={ticket.status==="PARTIALLY_PAID"
              ?"/pos/orders/"+ticket.id+"/split":"/pos?ticket="+ticket.id}
            className="pos-fast-ticket">
            {ticket.tableLabel??(ticket.serviceMode==="TAKEAWAY"?"Para llevar":ticket.folio)}
          </Link>)}
          {liveTickets.length===0&&<span className="muted">Sin mesas pendientes</span>}
        </div>
        <Link className="pos-fast-all" href="/pos/reabasto">Insumos <span aria-hidden="true">↗</span></Link>
        <Link className="pos-fast-all" href="/pos/orders">Comandas y cobro →</Link>
      </section>}
      {selectedTicketId&&!selectedTicket&&<p className="status-warn">
        Ese ticket ya no está abierto. Consulta el historial o crea uno nuevo.
      </p>}
      {typeof params.updated==="string"&&<p className="status-ok">Ronda guardada. Puedes seguir tomando pedidos.</p>}

      <PosClient
        extrasOptions={extrasOptions}
        key={selectedTicket?selectedTicket.id+":"+(typeof params.savedRound==="string"?params.savedRound:"open"):"NEW_TICKET"}
        catalog={catalog.filter(item=>!pilotItem || item.name.toLocaleUpperCase("es-MX")===pilotItem.toLocaleUpperCase("es-MX")).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: item.price,
        }))}
        staffEmployees={activeWorkers}
        usedStaffDrinkEmployeeIds={usedStaffDrinks.map(row=>row.beneficiaryEmployeeId)}
        customers={customers.map((customer) => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          pointsBalance: Number(customer.pointsBalance),
        }))}
        selectedCustomerId={selectedCustomerId}
        cashOpen={Boolean(cash.session)}
        liveEnabled={liveEnabled}
        savedTicket={selectedTicket?{
          id:selectedTicket.id,
          folio:selectedTicket.folio,
          name:selectedTicket.tableLabel??"Ticket guardado",
          total:Number(selectedTicket.total),
          customerId:selectedTicket.customerId,
          status:selectedTicket.status,
          serviceMode:selectedTicket.serviceMode==="TAKEAWAY"?"TAKEAWAY":"DINE_IN",
          lines:selectedTicket.lines.map(line=>({
            id:line.id,name:line.name,quantity:Number(line.quantity),
            note:line.note,unitPrice:Number(line.unitPrice),
            serviceMode:line.expectedConsumption?.serviceMode==="TAKEAWAY"?"TAKEAWAY":"DINE_IN",
            isAdditionalRound:line.isAdditionalRound,
            roundId:typeof line.expectedConsumption?.roundId==="string"
              ? line.expectedConsumption.roundId:null,
            extrasLabel:extraLabels(line.expectedConsumption,{showPrices:true}).join(" · ")||null,
          })),
        }:null}
      />

      <details className="pos-secondary-links">
        <summary>Herramientas adicionales · caja, historial, clientes, impresora</summary>
        <div className="pos-context-links">
        <Link href="/pos/orders" className="button">
          Ver comandas abiertas
        </Link>
        <Link href="/pos/cash" className="button">
          {cash.session
            ? "Caja abierta · " + money.format(cash.expectedCash)
            : "Abrir caja"}
        </Link>
        <Link href="/pos/tickets" className="button">Historial de tickets</Link>
        <Link href="/pos/customers" className="button">Clientes y puntos</Link>
        <Link href="/pos/reabasto" className="button">Reabasto rápido</Link>
        <Link href="/pos/inventory-audit" className="button">Auditoría inventario</Link>
        <Link href="/pos/performance" className="button">Tiempos y eficiencia</Link>
        <Link href="/pos/printer" className="button">
          Impresora
        </Link>
      </div>
      </details>


    </main>
  );
}
