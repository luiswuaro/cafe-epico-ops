import Link from "next/link";
import { PosClient } from "./pos-client";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { isPosLiveEnabled } from "@/src/application/pos/live";
import { getCashState } from "@/src/application/pos/cash";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getOpenPosOrders } from "@/src/application/pos/orders";
import {
  getRecentShadowOrders,
  getShadowOrderMirror,
} from "@/src/application/pos/mirror";
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

function time(date: Date | null) {
  if (!date) return "—";
  return date.toLocaleTimeString("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

  const [catalog, customers, recent, saved, canCancel, cash, openOrders] = await Promise.all([
    getPosCatalog(employee.organizationId),
    getPosCustomers(employee.organizationId),
    getRecentShadowOrders(
      employee.organizationId,
      employee.homeStoreId,
      6,
    ),
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
  ]);
  const liveTickets=openOrders.filter(order=>order.mode==="LIVE");
  const selectedTicket=liveEnabled&&selectedTicketId
    ? liveTickets.find(order=>order.id===selectedTicketId)??null : null;

  return (
    <main className="shell pos-shell">
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
              ? "Cobro operativo: descuenta cada ingrediente mapeado y abona puntos. No aceptará productos con recetas o saldos incompletos."
              : "Registra la misma venta que acabas de cobrar en Loyverse. En esta etapa OPS captura un espejo sin descontar insumos ni acreditar puntos."}
          </p>
        </div>
        <span className="status-warn">{liveEnabled ? "COBRO LIVE · INVENTARIO EXIGIDO" : "NO CONTABILIZA INVENTARIO"}</span>
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
        <Link href="/pos/inventory-audit" className="button">Auditoría inventario</Link>
        <Link href="/pos/printer" className="button">
          Impresora
        </Link>
      </div>

      {liveEnabled && (
        <section className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TICKETS GUARDADOS</p>
              <h2>Mesas abiertas</h2>
            </div>
            <span className="pill">{liveTickets.length} pendientes</span>
          </div>
          <p className="muted">Reabre una mesa para agregar bebidas desde este mismo POS. El ticket conserva su folio y separa lo anterior de la nueva ronda.</p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Link className="button" href="/pos">+ Ticket nuevo</Link>
            {liveTickets.map(ticket=>(
              <Link className="button" key={ticket.id}
                href={ticket.status==="PARTIALLY_PAID"
                  ? "/pos/orders/"+ticket.id+"/split"
                  : "/pos?ticket="+ticket.id}>
                {ticket.tableLabel??(ticket.serviceMode==="TAKEAWAY"?"Para llevar":ticket.folio)}
                {" · "}{money.format(Number(ticket.total))}
                {ticket.status==="PARTIALLY_PAID"?" · cobro parcial":""}
              </Link>
            ))}
          </div>
          {selectedTicketId&&!selectedTicket&&<p className="status-warn">
            Ese ticket no está abierto en esta sucursal. Selecciona otro o consulta el historial.
          </p>}
          {typeof params.updated==="string"&&<p className="status-ok">Ticket actualizado; nueva ronda guardada sin cobrar.</p>}
        </section>
      )}

      <PosClient
        catalog={catalog.filter(item=>!pilotItem || item.name.toLocaleUpperCase("es-MX")===pilotItem.toLocaleUpperCase("es-MX")).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: item.price,
        }))}
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
          })),
        }:null}
      />

      <section className="card pos-recent">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PRUEBAS RECIENTES</p>
            <h2>Historial de órdenes espejo</h2>
          </div>
          <span className="pill">{recent.length}</span>
        </div>
        {recent.length === 0 ? (
          <p className="muted">Todavía no hay ventas de prueba.</p>
        ) : (
          <div className="stack compact-stack">
            {recent.map((order) => (
              <Link
                href={"/pos?saved=" + order.id}
                className="task"
                key={order.id}
              >
                <div style={{ flex: 1 }}>
                  <strong>{order.folio}</strong>
                  <div className="muted">
                    {order.serviceMode === "TAKEAWAY"
                      ? "Para llevar"
                      : order.tableLabel || "Aquí"}
                    {" · "}
                    {time(order.paidAt)}
                  </div>
                </div>
                <strong>{money.format(Number(order.total))}</strong>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
