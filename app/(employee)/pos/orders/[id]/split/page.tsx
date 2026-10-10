import Link from "next/link";
import { SplitAccountBuilder } from "./split-client";
import {extraLabels} from "@/src/application/pos/extras";
import { SplitPaymentFields } from "./split-payment-fields";
import { payOrderSplit, resetUnpaidOrderSplit } from "./actions";
import { getCashState } from "@/src/application/pos/cash";
import { getPosCustomers } from "@/src/application/pos/customers";
import { getOrderSplitState } from "@/src/application/pos/splits";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission,employeeHasPermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export default async function SplitOrderPage({
  params,searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const { id } = await params;
  const query=await searchParams;
  const paymentError=typeof query.error==="string"?query.error.slice(0,300):null;
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const [state, cash, customers, canOverrideStock] = await Promise.all([
    getOrderSplitState(
      employee.organizationId,
      employee.homeStoreId,
      id,
    ),
    getCashState(employee.organizationId, employee.homeStoreId),
    getPosCustomers(employee.organizationId),
    employeeHasPermission(employee.id,"inventory.adjust",employee.homeStoreId),
  ]);

  if (!state) throw new Error("Orden no encontrada");

  const isClosed=state.order.status==="CANCELLED" || 
    (state.order.status==="PAID"&&state.splits.some(split=>split.status!=="PAID"));
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
        <div className="pos-result-actions">
          <Link href={"/pos/orders/"+state.order.id+"/prebill"} className="button pos-prebill-link">
            Precuenta completa de mesa
          </Link>
          <Link href="/pos/orders" className="button">
            Volver a comandas
          </Link>
        </div>
      </section>

      {isClosed&&<section className="card" role="status">
        <p className="status-warn">Ticket cerrado: {state.order.status==="CANCELLED"?"cancelado":"pagado"}.</p>
        <p className="muted">Se conserva el historial de cuentas, pero ya no permite nuevos cobros ni modificar la división.</p>
        <Link className="button" href={"/pos/receipt/"+state.order.id}>Ver ticket completo</Link>
      </section>}

      {paymentError && <section className="card" role="alert">
        <p className="status-bad">Cobro no confirmado: {paymentError}</p>
        <p className="muted">Comprueba cuáles cuentas siguen pendientes antes de repetir un pago. No se borró la división de la mesa.</p>
      </section>}

      {state.splits.length > 0 && (
        <section className="split-existing-grid">
          {state.splits.map((split) => (
            <article className="card" key={split.id}>
              <p className="eyebrow">
                {split.status === "PAID" ? "PAGADA" : isClosed ? "CERRADA" : "PENDIENTE"}
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
                      {extraLabels(line?.expectedConsumption,{showPrices:true}).map((x,i)=>
                        <div className="command-line-note" key={i}>↳ {x}</div>)}
                      {line?.note ? (
                        <div className="command-line-note">↳ {line.note}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {state.order.mode==="LIVE"&&split.status!=="PAID"&&!isClosed&&
                <Link className="button pos-prebill-link"
                  href={"/pos/orders/"+state.order.id+"/prebill?split="+split.id}>
                  Imprimir precuenta · {split.label}
                </Link>}
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
              ) : isClosed ? (
                <p className="muted">Cuenta bloqueada: folio cerrado.</p>
              ) : (
                <form action={payOrderSplit} className="stack">
                  <input type="hidden" name="splitId" value={split.id} />
                  <input type="hidden" name="orderId" value={state.order.id} />
                  <SplitPaymentFields
                    total={Number(split.total)}
                    cashOpen={Boolean(cash.session)}
                    live={state.order.mode==="LIVE"}
                  />
                  {state.order.mode==="LIVE" && <>
                    <label>Cliente que recibe los puntos (5%)
                      <select name="customerId" defaultValue={state.order.customerId??""}>
                        <option value="">Sin cliente · no acreditar puntos</option>
                        {customers.map(customer=><option key={customer.id} value={customer.id}>
                          {customer.name} · {Number(customer.pointsBalance).toFixed(2)} pts
                        </option>)}
                      </select>
                    </label>
                    {canOverrideStock&&<label>
                      <input type="checkbox" name="allowStockShortage"/>
                      {" "}Autorizar diferencia de inventario (sólo propietario)
                      <small className="muted">Si el producto ya se entregó, registra consumo negativo auditado y realiza conteo físico.</small>
                    </label>}
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

      {state.splits.length>0 && !hasPaidSplit && !isClosed && (
        <form action={resetUnpaidOrderSplit} className="card stack">
          <input type="hidden" name="orderId" value={state.order.id}/>
          <p className="muted">¿Cambió la forma de pago? Puedes quitar la división y cobrar la mesa completa. No se ha cobrado ninguna cuenta.</p>
          <button type="submit">Quitar división · regresar a cuenta completa</button>
        </form>
      )}

      {!hasPaidSplit && !isClosed && (
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
