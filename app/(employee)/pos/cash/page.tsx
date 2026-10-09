import Link from "next/link";
import { getCashState } from "@/src/application/pos/cash";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import {
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from "./actions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function time(date: Date) {
  return date.toLocaleTimeString("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function movementLabel(type: string) {
  if (type === "SALE") return "Venta efectivo";
  if (type === "CASH_IN") return "Entrada";
  if (type === "CASH_OUT") return "Salida";
  if (type === "REFUND") return "Reembolso";
  return type;
}

export default async function PosCashPage() {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.cash.manage",
    employee.homeStoreId,
  );

  const state = await getCashState(
    employee.organizationId,
    employee.homeStoreId,
  );

  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS · EFECTIVO</p>
          <h1>Caja</h1>
          <p className="muted">
            Fondo inicial + ventas en efectivo + entradas − salidas = efectivo
            esperado. En modo espejo sirve para comparar contra tu caja física.
          </p>
        </div>
        <Link href="/pos" className="button">
          Volver al POS
        </Link>
      </section>

      {!state.session ? (
        <section className="card">
          <p className="eyebrow">CAJA CERRADA</p>
          <h2>Abrir caja</h2>
          <form action={openCashSession} className="stack">
            <label>
              Fondo inicial
              <input
                name="openingCash"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0.00"
                required
              />
            </label>
            <label>
              Nota
              <input
                name="note"
                placeholder="Ej. fondo recibido de cierre anterior"
              />
            </label>
            <button type="submit">Abrir caja</button>
          </form>

          {state.lastClosed && (
            <p className="muted">
              Último cierre: esperado{" "}
              {money.format(Number(state.lastClosed.expectedCashSnapshot ?? 0))}
              {" · "}contado{" "}
              {money.format(Number(state.lastClosed.countedCash ?? 0))}
              {" · "}diferencia{" "}
              {money.format(Number(state.lastClosed.difference ?? 0))}
            </p>
          )}
        </section>
      ) : (
        <>
          {state.isStale && (
            <p className="alert">
              Esta caja quedó abierta de un día anterior. Ciérrala antes de
              registrar cobros en efectivo del día de hoy.
            </p>
          )}
          <section className="grid cash-kpis">
            <article className="card">
              <p className="eyebrow">FONDO</p>
              <strong className="metric">
                {money.format(Number(state.session.openingCash))}
              </strong>
            </article>
            <article className="card">
              <p className="eyebrow">VENTAS EFECTIVO</p>
              <strong className="metric">
                {money.format(state.cashSales)}
              </strong>
            </article>
            <article className="card">
              <p className="eyebrow">ENTRADAS / SALIDAS</p>
              <strong className="metric">
                +{money.format(state.cashIn)} / −{money.format(state.cashOut)}
              </strong>
            </article>
            <article className="card">
              <p className="eyebrow">ESPERADO AHORA</p>
              <strong className="metric">
                {money.format(state.expectedCash)}
              </strong>
            </article>
          </section>

          <section className="grid cash-actions-grid">
            <article className="card">
              <p className="eyebrow">MOVIMIENTO MANUAL</p>
              <h2>Entrada / salida</h2>
              <form action={recordCashMovement} className="stack">
                <label>
                  Tipo
                  <select name="movementType" defaultValue="CASH_OUT">
                    <option value="CASH_IN">Entrada de efectivo</option>
                    <option value="CASH_OUT">Salida de efectivo</option>
                  </select>
                </label>
                <label>
                  Monto
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Motivo
                  <input
                    name="note"
                    required
                    minLength={3}
                    placeholder="Ej. compra urgente de leche"
                  />
                </label>
                <button type="submit">Registrar movimiento</button>
              </form>
            </article>

            <article className="card">
              <p className="eyebrow">ARQUEO</p>
              <h2>Cerrar caja</h2>
              <p>
                OPS espera actualmente{" "}
                <strong>{money.format(state.expectedCash)}</strong>.
              </p>
              <form action={closeCashSession} className="stack">
                <label>
                  Efectivo contado
                  <input
                    name="countedCash"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Nota de cierre
                  <textarea
                    name="closingNote"
                    rows={3}
                    placeholder="Opcional"
                  />
                </label>
                <button type="submit">Cerrar y calcular diferencia</button>
              </form>
            </article>
          </section>

          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MOVIMIENTOS</p>
                <h2>Actividad de esta caja</h2>
              </div>
              <span className="pill">{state.movements.length}</span>
            </div>

            {state.movements.length === 0 ? (
              <p className="muted">Todavía no hay movimientos.</p>
            ) : (
              <div className="stack compact-stack">
                {state.movements.map((movement) => (
                  <div className="task" key={movement.id}>
                    <div style={{ flex: 1 }}>
                      <strong>{movementLabel(movement.movementType)}</strong>
                      <div className="muted">
                        {time(movement.createdAt)}
                        {" · "}
                        {movement.employeeName ?? "Empleado"}
                        {movement.note ? " · " + movement.note : ""}
                      </div>
                    </div>
                    <strong>
                      {Number(movement.amount) >= 0 ? "+" : ""}
                      {money.format(Number(movement.amount))}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
