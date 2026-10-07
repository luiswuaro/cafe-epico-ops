import Link from "next/link";
import {
  cancelPosOrder,
  payShadowCommand,
  updateCommandStatus,
} from "../actions";
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

  const [orders, canCancel] = await Promise.all([
    getOpenPosOrders(employee.organizationId, employee.homeStoreId),
    employeeHasPermission(
      employee.id,
      "pos.cancel",
      employee.homeStoreId,
    ),
  ]);

  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · COMANDAS</p>
          <h1>Comandas abiertas</h1>
          <p className="muted">
            Todos los dispositivos ven la misma cola mientras están conectados.
            En esta etapa sigue siendo modo espejo y no descuenta inventario.
          </p>
        </div>
        <Link href="/pos" className="button">
          + Nueva orden
        </Link>
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
          {orders.map((order) => (
            <article className="card command-card" key={order.id}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {statusLabel(order.status)} · {elapsedMinutes(order.createdAt)} min
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
                  <div key={line.id}>
                    <strong>{Number(line.quantity)}×</strong> {line.name}
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
                {order.customerName ? " · Cliente: " + order.customerName : ""}
              </div>

              {Number(order.loyaltyPointsPreview) > 0 && (
                <div className="muted">
                  Puntos que generaría:{" "}
                  <strong>{Number(order.loyaltyPointsPreview).toFixed(2)}</strong>
                </div>
              )}

              <div className="command-status-actions">
                {order.status !== "PREPARING" && (
                  <form action={updateCommandStatus}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="status" value="PREPARING" />
                    <button type="submit">Preparando</button>
                  </form>
                )}
                {order.status !== "READY" && (
                  <form action={updateCommandStatus}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="status" value="READY" />
                    <button type="submit">Lista</button>
                  </form>
                )}
              </div>

              <details>
                <summary>Cobrar / cerrar comanda</summary>
                <form action={payShadowCommand} className="stack">
                  <input type="hidden" name="orderId" value={order.id} />
                  <label>
                    Método de pago
                    <select name="paymentMethod" defaultValue="CASH">
                      <option value="CASH">Efectivo</option>
                      <option value="CARD">Tarjeta</option>
                      <option value="TRANSFER">Transferencia</option>
                    </select>
                  </label>
                  <button type="submit">
                    Marcar pagada · {money.format(Number(order.total))}
                  </button>
                </form>
              </details>

              {canCancel && (
                <details className="pos-cancel-panel">
                  <summary>Cancelar comanda</summary>
                  <form action={cancelPosOrder} className="stack">
                    <input type="hidden" name="orderId" value={order.id} />
                    <label>
                      Motivo
                      <input name="reason" required minLength={3} />
                    </label>
                    <button type="submit">Cancelar como administrador</button>
                  </form>
                </details>
              )}

              <small className="muted">{order.folio}</small>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
