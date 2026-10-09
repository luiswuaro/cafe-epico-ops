import Link from "next/link";
import { SplitAccountBuilder } from "./split-client";
import { payOrderSplit } from "./actions";
import { getCashState } from "@/src/application/pos/cash";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getOrderSplitState } from "@/src/application/pos/splits";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export default async function SplitOrderPage({
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

  const [state, cash, customers] = await Promise.all([
    getOrderSplitState(
      employee.organizationId,
      employee.homeStoreId,
      id,
    ),
    getCashState(employee.organizationId, employee.homeStoreId),
    getPosCustomers(employee.organizationId),
  ]);

  if (!state) throw new Error("Orden no encontrada");

  const hasPaidSplit = state.splits.some(
    (split) => split.status === "PAID",
  );

  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · CUENTA DIVIDIDA</p>
          <h1>{state.order.tableLabel || "Orden " + state.order.folio}</h1>
          <p className="muted">
            Asigna cada unidad a una cuenta. Cada cuenta se cobra por separado
            y puede generar su propio ticket. En LIVE, cada cuenta descuenta sólo los productos asignados al pagar.
          </p>
        </div>
        <Link href="/pos/orders" className="button">
          Volver a comandas
        </Link>
      </section>

      {state.splits.length > 0 && (
        <section className="split-existing-grid">
          {state.splits.map((split) => (
            <article className="card" key={split.id}>
              <p className="eyebrow">
                {split.status === "PAID" ? "PAGADA" : "PENDIENTE"}
              </p>
              <h2>{split.label}</h2>
              <strong className="metric">
                {money.format(Number(split.total))}
              </strong>

              <div className="split-mini-lines">
                {split.lines.map((assignment) => {
                  const line = state.lines.find(
                    (row) => row.id === assignment.orderLineId,
                  );
                  return (
                    <div key={assignment.id}>
                      {Number(assignment.quantity)}×{" "}
                      {line?.nameSnapshot ?? "Producto"}
                      {line?.note ? (
                        <div className="command-line-note">↳ {line.note}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {split.status === "PAID" ? (
                <Link
                  href={
                    "/pos/receipt/" +
                    state.order.id +
                    "?split=" +
                    split.id
                  }
                  className="button"
                >
                  Ver ticket
                </Link>
              ) : (
                <form action={payOrderSplit} className="stack">
                  <input type="hidden" name="splitId" value={split.id} />
                  <label>
                    Método de pago
                    <select
                      name="paymentMethod"
                      defaultValue={cash.session ? "CASH" : "CARD"}
                    >
                      <option value="CASH" disabled={!cash.session}>
                        Efectivo{cash.session ? "" : " · abre caja"}
                      </option>
                      <option value="CARD">Tarjeta</option>
                      <option value="TRANSFER">Transferencia</option>
                    </select>
                  </label>
                  {state.order.mode==="LIVE" && <>
                    <label>Cliente que recibe los puntos (5%)
                      <select name="customerId" defaultValue={state.order.customerId??""}>
                        <option value="">Sin cliente · no acreditar puntos</option>
                        {customers.map(customer=><option key={customer.id} value={customer.id}>
                          {customer.name} · {Number(customer.pointsBalance).toFixed(2)} pts
                        </option>)}
                      </select>
                    </label>
                    <label>Efectivo recibido (si paga en efectivo)
                      <input type="number" name="tenderedAmount" step="0.01" min={0}
                        defaultValue={Number(split.total).toFixed(2)}/>
                    </label>
                  </>}
                  <button type="submit">
                    Cobrar {money.format(Number(split.total))}
                  </button>
                </form>
              )}
            </article>
          ))}
        </section>
      )}

      {!hasPaidSplit && (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DISTRIBUCIÓN</p>
              <h2>
                {state.splits.length > 0
                  ? "Modificar división"
                  : "Crear cuentas individuales"}
              </h2>
            </div>
            <strong>{money.format(Number(state.order.total))}</strong>
          </div>

          <SplitAccountBuilder
            orderId={state.order.id}
            lines={state.lines.map((line) => ({
              id: line.id,
              name: line.nameSnapshot,
              note: line.note,
              quantity: Number(line.quantity),
              unitPrice: Number(line.unitPrice),
            }))}
          />
        </section>
      )}

      {hasPaidSplit && (
        <p className="card muted">
          La división queda bloqueada después del primer pago para conservar la
          trazabilidad de las cuentas ya cobradas.
        </p>
      )}
    </main>
  );
}
