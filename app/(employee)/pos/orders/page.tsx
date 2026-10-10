import Link from "next/link";
import { CommandBoardAutoRefresh } from "./auto-refresh";
import { KitchenPrintButton } from "./kitchen-print-button";
import { AutoKitchenPrint } from "./auto-kitchen-print";
import { kitchenOrderIdentity } from "@/src/application/pos/kitchen-slip";
import {extraLabels,preparationNote} from "@/src/application/pos/extras";
import {getPosExtraCatalog} from "@/src/application/pos/extra-catalog";
import { AddLiveProducts } from "./add-live-products";
import { createLiveCommandCustomer, setLiveCommandCustomer } from "./live-actions";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { getPosCustomers } from "@/src/application/pos/customers";
import {
  cancelPosOrder,
  payShadowCommand,
  updateCommandStatus,
} from "../actions";
import { getCashState } from "@/src/application/pos/cash";
import { getOpenPosOrders } from "@/src/application/pos/orders";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import {
  assertEmployeePermission,
  employeeHasPermission,
} from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function elapsedMinutes(date: Date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}

function statusLabel(status: string) {
  if (status === "SENT") return "NUEVA";
  if (status === "PREPARING") return "PREPARANDO";
  if (status === "READY") return "LISTA";
  if (status === "PARTIALLY_PAID") return "COBRO PARCIAL";
  return status;
}

export default async function PosOrdersPage({
  searchParams,
}:{
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const params=await searchParams;
  const error=typeof params.error==="string"?params.error.slice(0,260):null;
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const [orders, canCancel, cash, catalog, customers, extrasOptions] = await Promise.all([
    getOpenPosOrders(employee.organizationId, employee.homeStoreId),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
    getCashState(employee.organizationId, employee.homeStoreId),
    getPosCatalog(employee.organizationId),
    getPosCustomers(employee.organizationId),
    getPosExtraCatalog(employee.organizationId),
  ]);

  // Sólo acciones de guardado confirmadas incluyen autoKitchen=saved.
  // Nunca iniciar una impresión al abrir / refrescar Comandas normalmente.
  const autoId=typeof params.created==="string"?params.created
    :typeof params.added==="string"?params.added:null;
  const autoOrder=params.autoKitchen==="saved"&&autoId
    ?orders.find(order=>order.id===autoId&&order.mode==="LIVE")
    :null;
  const autoRoundId=autoOrder
    ?typeof params.round==="string"?params.round:"INITIAL"
    :null;

  return (
    <main className="shell pos-shell">
      {autoOrder&&autoRoundId&&autoOrder.lines.some(line=>
        (line.expectedConsumption?.roundId||"INITIAL")===autoRoundId
      )&&<AutoKitchenPrint
        event="saved"
        eventId={autoOrder.id+":"+autoRoundId}
        roundId={autoRoundId}
        slip={{
          folio:autoOrder.folio,
          ...kitchenOrderIdentity({ticketLabel:autoOrder.tableLabel,customerName:autoOrder.customerName,folio:autoOrder.folio}),
          orderNote:autoOrder.note,
          lines:autoOrder.lines.map(line=>({
            id:line.id,name:line.name,category:line.category,
            quantity:Number(line.quantity),note:preparationNote(line.note,line.expectedConsumption),
            serviceMode:typeof line.expectedConsumption?.serviceMode==="string"
              ?line.expectedConsumption.serviceMode:null,
            roundId:typeof line.expectedConsumption?.roundId==="string"
              ?line.expectedConsumption.roundId:null,
          })),
        }}
      />}
      <CommandBoardAutoRefresh />
      {error && <section className="card status-bad" role="alert">
        Comanda no cobrada: {error}
      </section>}

      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · COMANDAS</p>
          <h1>Comandas abiertas</h1>
          <p className="muted">
            La cola se actualiza automáticamente cada 5 segundos para que
            celular y caja vean las mismas órdenes conectadas.
          </p>
        </div>
        <div className="pos-result-actions">
          <Link href="/pos/cash" className="button">
            {cash.session ? "Caja abierta" : "Abrir caja"}
          </Link>
          <Link href="/pos" className="button">
            + Nueva orden
          </Link>
        </div>
      </section>

      {orders.length === 0 ? (
        <section className="card">
          <h2>Sin comandas abiertas</h2>
          <p className="muted">
            Cuando alguien pulse “Enviar comanda” desde el POS aparecerá aquí.
          </p>
        </section>
      ) : (
        <section className="command-board">
          {orders.map((order) => {
            const partiallyPaid = order.status === "PARTIALLY_PAID";
            const roundKey=(line:typeof order.lines[number])=>
              typeof line.expectedConsumption?.roundId==="string"?line.expectedConsumption.roundId:"INITIAL";
            const roundKeys=[...new Set(order.lines.map(roundKey))];

            return (
              <article className="card command-card" key={order.id}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {order.mode === "LIVE" ? "LIVE · " : "ESPEJO · "}{statusLabel(order.status)} ·{" "}
                      {elapsedMinutes(order.createdAt)} min
                    </p>
                    <h2>
                      {kitchenOrderIdentity({
                        ticketLabel:order.tableLabel,
                        customerName:order.customerName,
                        folio:order.folio,
                      }).table}
                    </h2>
                  </div>
                  <strong>{money.format(Number(order.total))}</strong>
                </div>

                <div className="command-lines">
                  {order.lines.map((line,index) => (
                    <div key={line.id}>
                      {order.mode==="LIVE" &&
                        (index===0 || roundKey(order.lines[index-1])!==roundKey(line)) && (
                        <div style={{padding:"8px 0",borderBottom:"1px solid currentColor"}}>
                          <strong>{roundKeys.indexOf(roundKey(line))===0
                            ?"PRIMER PEDIDO":"RONDA "+(roundKeys.indexOf(roundKey(line))+1)}</strong>
                        </div>
                      )}
                      <div className="command-line-item">
                        <div>
                          <strong>{Number(line.quantity)}×</strong> {line.name}
                          {order.mode==="LIVE" && (
                            <span className="muted" style={{marginLeft:8}}>
                              · {line.expectedConsumption?.serviceMode==="TAKEAWAY"?"PARA LLEVAR":"AQUÍ"}
                            </span>
                          )}
                        </div>
                        {extraLabels(line.expectedConsumption,{showPrices:true}).map((label,i)=>
                          <div key={i} className="command-line-note">↳ {label}</div>)}
                        {line.note && <div className="command-line-note">↳ {line.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {order.note && (
                  <div className="handoff-note-preview">
                    <strong>Nota:</strong> {order.note}
                  </div>
                )}

                <div className="muted">
                  Tomó: {order.employeeName ?? "Empleado"}
                  {kitchenOrderIdentity({
                    ticketLabel:order.tableLabel,
                    customerName:order.customerName,
                    folio:order.folio,
                  }).customerName
                    ? " · Cliente: "+order.customerName
                    : ""}
                </div>

                {!partiallyPaid && Number(order.loyaltyPointsPreview) > 0 && (
                  <div className="muted">
                    Puntos que generaría:{" "}
                    <strong>
                      {Number(order.loyaltyPointsPreview).toFixed(2)}
                    </strong>
                  </div>
                )}

                {partiallyPaid && order.mode==="LIVE" && <p className="muted">
                  Puntos acreditados por cuenta pagada.
                </p>}

                {!partiallyPaid && (
                  <div className="command-status-actions">
                    {order.status !== "PREPARING" && (
                      <form action={updateCommandStatus}>
                        <input
                          type="hidden"
                          name="orderId"
                          value={order.id}
                        />
                        <input
                          type="hidden"
                          name="status"
                          value="PREPARING"
                        />
                        <button type="submit">Preparando</button>
                      </form>
                    )}
                    {order.status !== "READY" && (
                      <form action={updateCommandStatus}>
                        <input
                          type="hidden"
                          name="orderId"
                          value={order.id}
                        />
                        <input type="hidden" name="status" value="READY" />
                        <button type="submit">Lista</button>
                      </form>
                    )}
                  </div>
                )}

                {order.mode==="LIVE"&&
                  <KitchenPrintButton
                    slip={{
                      folio:order.folio,
                      ...kitchenOrderIdentity({ticketLabel:order.tableLabel,customerName:order.customerName,folio:order.folio}),
                      orderNote:order.note,
                      lines:order.lines.map(line=>({
                        id:line.id,
                        name:line.name,
                        category:line.category,
                        quantity:Number(line.quantity),
                        note:preparationNote(line.note,line.expectedConsumption),
                        serviceMode:typeof line.expectedConsumption?.serviceMode==="string"
                          ?line.expectedConsumption.serviceMode:null,
                        roundId:typeof line.expectedConsumption?.roundId==="string"
                          ?line.expectedConsumption.roundId:null,
                      })),
                    }}
                    viewUrl={"/pos/orders/"+order.id+"/kitchen"}
                  />}
                {order.mode==="LIVE"&&
                  <Link className="button pos-prebill-link" href={"/pos/orders/"+order.id+"/prebill"}>
                    Imprimir precuenta · {order.tableLabel??"mesa"}
                  </Link>}
                {(
                  <Link
                    href={"/pos/orders/" + order.id + "/split"}
                    className="button"
                  >
                    {partiallyPaid ? "Continuar cobros divididos" : "Dividir cuenta"}
                  </Link>
                )}

                {order.mode==="LIVE" && !partiallyPaid && (
                  <Link href={"/pos?ticket="+order.id} className="button">
                    <span>Reabrir ticket en POS · agregar productos</span>
                  </Link>
                )}

                {order.mode==="LIVE" && !partiallyPaid && (
                  <>
                    <AddLiveProducts orderId={order.id} extrasOptions={extrasOptions}
                      products={catalog.filter(item=>item.active).map(item=>({
                        id:item.id,name:item.name,category:item.category,price:item.price
                      }))}/>
                    <details className="pos-cancel-panel">
                      <summary>Cliente y puntos · 5%</summary>
                      <div className="stack" style={{paddingTop:12}}>
                        <form action={setLiveCommandCustomer} className="stack">
                          <input name="orderId" type="hidden" value={order.id}/>
                          <label>Cliente asociado
                            <select name="customerId" defaultValue={order.customerId??""}>
                              <option value="">Sin cliente · no genera puntos</option>
                              {customers.map(customer=><option key={customer.id} value={customer.id}>
                                {customer.name} · {Number(customer.pointsBalance).toFixed(2)} pts
                              </option>)}
                            </select>
                          </label>
                          <button type="submit">Guardar cliente de la mesa</button>
                        </form>
                        <details>
                          <summary>+ Registrar nuevo cliente</summary>
                          <form action={createLiveCommandCustomer} className="stack">
                            <input name="orderId" type="hidden" value={order.id}/>
                            <label>Nombre<input name="name" required minLength={2} maxLength={150}/></label>
                            <label>Teléfono (opcional)<input name="phone" type="tel"/></label>
                            <button type="submit">Registrar y asociar a mesa</button>
                          </form>
                        </details>
                        <p className="muted">Los puntos se acreditan únicamente cuando se cobra. En cuentas divididas puedes elegir un cliente distinto para cada pago.</p>
                      </div>
                    </details>
                  </>
                )}

                {!partiallyPaid && (order.mode==="LIVE"
                  ? <Link href={"/pos/checkout?ticket="+order.id} className="button">
                      Cobrar cuenta · {money.format(Number(order.total))}
                    </Link>
                  : <details>
                      <summary>Cobrar cuenta completa · espejo</summary>
                      <form action={payShadowCommand} className="stack">
                        <input type="hidden" name="orderId" value={order.id}/>
                        <label>Método de pago
                          <select name="paymentMethod" defaultValue={cash.session?"CASH":"CARD"}>
                            <option value="CASH" disabled={!cash.session}>
                              Efectivo{cash.session?"":" · abre caja"}
                            </option>
                            <option value="CARD">Tarjeta</option>
                            <option value="TRANSFER">Transferencia</option>
                          </select>
                        </label>
                        <button type="submit">Marcar pagada · {money.format(Number(order.total))}</button>
                      </form>
                    </details>
                )}

                {canCancel && (
                  <details className="pos-cancel-panel">
                    <summary>Cancelar comanda</summary>
                    <form action={cancelPosOrder} className="stack">
                      <input
                        type="hidden"
                        name="orderId"
                        value={order.id}
                      />
                      <label>
                        Motivo
                        <input name="reason" required minLength={3} />
                      </label>
                      <button type="submit">
                        Cancelar como administrador
                      </button>
                    </form>
                  </details>
                )}

                <small className="muted">{order.folio}</small>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
