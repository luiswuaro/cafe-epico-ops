import Link from "next/link";
import { CommandBoardAutoRefresh } from "./auto-refresh";
import {
  cancelPosOrder,
  payLiveCommand,
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

export default async function PosOrdersPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const [orders, canCancel, cash] = await Promise.all([
    getOpenPosOrders(employee.organizationId, employee.homeStoreId),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
    getCashState(employee.organizationId, employee.homeStoreId),
  ]);

  return (
    <main className="shell pos-shell">
      <CommandBoardAutoRefresh />

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

            return (
              <article className="card command-card" key={order.id}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {order.mode === "LIVE" ? "LIVE · " : "ESPEJO · "}{statusLabel(order.status)} ·{" "}
                      {elapsedMinutes(order.createdAt)} min
                    </p>
                    <h2>
                      {order.serviceMode === "TAKEAWAY"
                        ? "Para llevar"
                        : order.tableLabel || "Aquí"}
                    </h2>
                  </div>
                  <strong>{money.format(Number(order.total))}</strong>
                </div>

                <div className="command-lines">
                  {order.lines.map((line) => (
                    <div className="command-line-item" key={line.id}>
                      <div>
                        <strong>{Number(line.quantity)}×</strong> {line.name}
                      </div>
                      {line.note && (
                        <div className="command-line-note">↳ {line.note}</div>
                      )}
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
                  {order.customerName
                    ? " · Cliente: " + order.customerName
                    : ""}
                </div>

                {Number(order.loyaltyPointsPreview) > 0 && (
                  <div className="muted">
                    Puntos que generaría:{" "}
                    <strong>
                      {Number(order.loyaltyPointsPreview).toFixed(2)}
                    </strong>
                  </div>
                )}

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

                {order.mode !== "LIVE" && (
                  <Link
                    href={"/pos/orders/" + order.id + "/split"}
                    className="button"
                  >
                    {partiallyPaid ? "Continuar cuentas divididas" : "Dividir cuenta"}
                  </Link>
                )}

                {!partiallyPaid && (
                  <details>
                    <summary>Cobrar cuenta completa</summary>
                    <form action={order.mode === "LIVE" ? payLiveCommand : payShadowCommand} className="stack">
                      <input
                        type="hidden"
                        name="orderId"
                        value={order.id}
                      />
                      <label>
                        Método de pago
                        <select
                          name="paymentMethod"
                          defaultValue={cash.session ? "CASH" : "CARD"}
                        >
                          <option value="CASH" disabled={!cash.session}>
                            Efectivo
                            {cash.session ? "" : " · abre caja"}
                          </option>
                          <option value="CARD">Tarjeta</option>
                          <option value="TRANSFER">Transferencia</option>
                        </select>
                      </label>
                      {order.mode === "LIVE" && (
                        <>
                          <p className="muted">
                            Cobro LIVE: descontará inventario y registrará caja y puntos al pagar.
                          </p>
                          <label>
                            Efectivo recibido (si es efectivo)
                            <input name="tenderedAmount" type="number" min={0}
                              step="0.01" placeholder={Number(order.total).toFixed(2)} />
                          </label>
                        </>
                      )}
                      <button type="submit">
                        {order.mode === "LIVE" ? "Cobrar LIVE" : "Marcar pagada"} ·{" "}
                        {money.format(Number(order.total))}
                      </button>
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
