import Link from "next/link";
import { PosClient } from "./pos-client";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { getCashState } from "@/src/application/pos/cash";
import { getPosCustomers } from "@/src/application/pos/customers";
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
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const savedId = typeof params.saved === "string" ? params.saved : null;
  const selectedCustomerId =
    typeof params.customer === "string" ? params.customer : null;

  const [catalog, customers, recent, saved, canCancel, cash] = await Promise.all([
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
  ]);

  return (
    <main className="shell pos-shell">
      <section className="hero pos-hero">
        <div>
          <p className="eyebrow">POS V0.1 · MODO ESPEJO</p>
          <h1>Tomar orden</h1>
          <p className="muted">
            Registra la misma venta que acabas de cobrar en Loyverse. En esta
            etapa OPS no modifica inventario ni caja; sólo captura la venta y
            calcula lo que habría consumido.
          </p>
        </div>
        <span className="status-warn">NO CONTABILIZA INVENTARIO</span>
      </section>

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
              <p className="eyebrow">VENTA REGISTRADA · {saved.order.folio}</p>
              <h2>
                {saved.order.status === "CANCELLED"
                  ? "Venta cancelada"
                  : saved.mirror?.exact
                    ? "Espejo exacto encontrado"
                    : saved.mirror
                      ? "Encontré una venta para revisar"
                      : "OPS guardó la venta; falta encontrar su espejo"}
              </h2>
            </div>
            <strong className="metric">{money.format(Number(saved.order.total))}</strong>
          </div>

          {saved.mirror ? (
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
              Nueva orden espejo
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
      </div>

      <PosClient
        catalog={catalog.map((item) => ({
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
      />

      <section className="card pos-recent">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PRUEBAS RECIENTES</p>
            <h2>Ventas espejo</h2>
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
