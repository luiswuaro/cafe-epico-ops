import Link from "next/link";
import {
  addManualPurchaseLine,
  createSupplier,
  generateSuggestedPurchasePlan,
  saveLoyverseItemSetting,
  updatePurchaseLine,
  updatePurchasePlan,
} from "./actions";
import { getPurchasingAdminData } from "@/src/application/purchases/admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export default async function PurchasesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { organizationId } =
    await requirePermission("purchase.manage");
  const data = await getPurchasingAdminData(organizationId);

  const suggestions = data.inventory.smartRows.filter(
    (row) => row.suggestedPurchase > 0.0005,
  );

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · COMPRAS</p>
        <h1>Proveedores, costos y requisiciones</h1>
        <p className="muted">
          Loyverse sigue siendo la fuente de existencias. Aquí configuramos
          costo real, presentación de compra, proveedor y viajes/requisiciones.
        </p>
      </section>

      {params.supplier === "created" && (
        <p className="card status-ok">Proveedor creado.</p>
      )}
      {params.setting === "saved" && (
        <p className="card status-ok">Configuración de insumo guardada.</p>
      )}
      {typeof params.error === "string" && (
        <p className="alert">
          No se pudo completar la operación: {params.error}
        </p>
      )}

      <section className="grid">
        <form action={createSupplier} className="card stack">
          <h2>Nuevo proveedor</h2>
          <label>
            Nombre
            <input name="name" required placeholder="Ej. Sam's Club" />
          </label>
          <label>
            Ciudad / zona
            <input name="city" placeholder="Puebla" />
          </label>
          <label>
            Contacto
            <input name="contact" placeholder="Teléfono, WhatsApp o vendedor" />
          </label>
          <label>
            Nota
            <input name="notes" placeholder="Días de entrega, condiciones..." />
          </label>
          <button type="submit">Guardar proveedor</button>
        </form>

        <form action={generateSuggestedPurchasePlan} className="card stack">
          <h2>Generar requisición automática</h2>
          <p className="muted">
            Usa stock Loyverse, consumo teórico, cobertura, lead time, stock de
            seguridad y presentación de compra.
          </p>
          <label>
            Título opcional
            <input name="title" placeholder="Compra semanal" />
          </label>
          <label>
            Destino
            <input name="destination" defaultValue="Puebla" />
          </label>
          <label>
            Fecha planeada opcional
            <input name="plannedFor" type="date" />
          </label>
          <button type="submit" disabled={suggestions.length === 0}>
            Crear plan con {suggestions.length} sugerencias
          </button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Qué comprar y cuándo</h2>
        <p className="muted">
          La cantidad sugerida se redondea a cajas/paquetes cuando defines una
          presentación. El costo usa tu override; si no existe, usa el costo
          Loyverse.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Insumo</th>
                <th>Stock</th>
                <th>Cons./día</th>
                <th>Cobertura</th>
                <th>Comprar</th>
                <th>Empaques</th>
                <th>Fecha</th>
                <th>Costo</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((row) => (
                <tr key={row.variantExternalId}>
                  <td>
                    <strong>{row.itemName}</strong>
                    <div className="muted">
                      {row.supplierName ?? "Sin proveedor"}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(row.inStock)} {row.unitLabel}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(row.avgDailyUsage14)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.daysCover == null
                      ? "—"
                      : row.daysCover.toFixed(1) + " d"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {number.format(row.suggestedPurchase)} {row.unitLabel}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.suggestedPackages == null
                      ? "—"
                      : row.suggestedPackages +
                        " × " +
                        (row.packageName ?? "paquete")}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.orderDate ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.suggestedCost == null
                      ? "—"
                      : money.format(row.suggestedCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Configurar insumos</h2>
        <p className="muted">
          Ejemplo leche: unidad Loyverse = L, costo override = 24, empaque =
          “Caja 12 × 1 L”, cantidad por empaque = 12, precio = 288.
        </p>

        <div className="stack">
          {data.inventory.rows.map((row) => (
            <details className="task" key={row.variantExternalId}>
              <summary style={{ cursor: "pointer" }}>
                <strong>{row.itemName}</strong> · stock{" "}
                {number.format(row.inStock)} {row.unitLabel} · costo{" "}
                {row.purchaseCost == null
                  ? "sin definir"
                  : money.format(row.purchaseCost)}
                {row.costSource === "OVERRIDE" ? " · override" : ""}
              </summary>
              <form
                action={saveLoyverseItemSetting}
                className="stack"
                style={{ marginTop: ".8rem", width: "100%" }}
              >
                <input
                  type="hidden"
                  name="variantExternalId"
                  value={row.variantExternalId}
                />
                <div className="grid">
                  <label>
                    Costo por unidad Loyverse
                    <input
                      name="unitCostOverride"
                      type="number"
                      min="0"
                      step="0.0001"
                      defaultValue={
                        row.costSource === "OVERRIDE" &&
                        row.purchaseCost != null
                          ? row.purchaseCost
                          : ""
                      }
                      placeholder={
                        row.loyversePurchaseCost == null
                          ? "Sin costo Loyverse"
                          : String(row.loyversePurchaseCost)
                      }
                    />
                  </label>

                  <label>
                    Proveedor
                    <select
                      name="supplierId"
                      defaultValue={row.supplierId ?? ""}
                    >
                      <option value="">Sin proveedor</option>
                      {data.suppliers
                        .filter((supplier) => supplier.isActive)
                        .map((supplier) => (
                          <option value={supplier.id} key={supplier.id}>
                            {supplier.name}
                            {supplier.city ? " · " + supplier.city : ""}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    Presentación
                    <input
                      name="packageName"
                      defaultValue={row.packageName ?? ""}
                      placeholder="Caja 12 × 1 L"
                    />
                  </label>

                  <label>
                    Cantidad por empaque
                    <input
                      name="packageQuantityNative"
                      type="number"
                      min="0"
                      step="0.001"
                      defaultValue={row.packageQuantityNative ?? ""}
                      placeholder="12"
                    />
                  </label>

                  <label>
                    Precio del empaque
                    <input
                      name="packagePrice"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={row.packagePrice ?? ""}
                    />
                  </label>

                  <label>
                    Lead time · días
                    <input
                      name="leadDays"
                      type="number"
                      min="0"
                      max="60"
                      defaultValue={row.leadDays}
                    />
                  </label>

                  <label>
                    Seguridad · días
                    <input
                      name="safetyDays"
                      type="number"
                      min="0"
                      max="60"
                      defaultValue={row.safetyDays}
                    />
                  </label>

                  <label>
                    Unidad para recetario
                    <select
                      name="displayUnit"
                      defaultValue={row.displayUnit ?? ""}
                    >
                      <option value="">Automática</option>
                      <option value="g">g</option>
                      <option value="ml">ml</option>
                      <option value="pz">pz</option>
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                    </select>
                  </label>

                  <label>
                    Factor visual
                    <input
                      name="displayFactor"
                      type="number"
                      min="0"
                      step="0.001"
                      defaultValue={
                        row.displayUnit ? row.displayFactor : ""
                      }
                      placeholder={
                        row.soldByWeight ? "1000" : "1"
                      }
                    />
                  </label>
                </div>

                <label>
                  Nota de compra
                  <input
                    name="notes"
                    maxLength={500}
                    defaultValue={row.purchaseNotes ?? ""}
                    placeholder="Ej. comprar solo cuando haya viaje a Puebla"
                  />
                </label>

                <button type="submit">Guardar configuración</button>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Planes de compra</h2>
        {data.plans.length === 0 ? (
          <p className="muted">Todavía no hay requisiciones.</p>
        ) : (
          <div className="stack">
            {data.plans.map((plan) => (
              <details
                className="task"
                key={plan.id}
                open={params.plan === plan.id}
              >
                <summary style={{ cursor: "pointer" }}>
                  <strong>{plan.title}</strong> · {plan.status} ·{" "}
                  {plan.estimatedBudget
                    ? money.format(Number(plan.estimatedBudget))
                    : "sin presupuesto"}
                </summary>

                <div style={{ width: "100%", marginTop: ".8rem" }}>
                  <p className="muted">
                    {plan.destination ?? "Sin destino"} ·{" "}
                    {plan.plannedFor
                      ? plan.plannedFor.toLocaleDateString("es-MX", {
                          timeZone: "America/Mexico_City",
                        })
                      : "sin fecha"}
                  </p>

                  <div className="stack">
                    {plan.lines.map((line) => (
                      <details className="task" key={line.id}>
                        <summary style={{ cursor: "pointer" }}>
                          <strong>{line.itemNameSnapshot}</strong>
                          {" · "}
                          {line.status}
                          {" · "}
                          {line.packageCount
                            ? line.packageCount +
                              " × " +
                              (line.packageNameSnapshot ?? "paquete")
                            : (line.requestedNativeQuantity ?? "—") +
                              " unidades"}
                          {line.estimatedTotal
                            ? " · " +
                              money.format(Number(line.estimatedTotal))
                            : ""}
                        </summary>

                        <form
                          action={updatePurchaseLine}
                          className="stack"
                          style={{ marginTop: ".7rem", width: "100%" }}
                        >
                          <input
                            type="hidden"
                            name="lineId"
                            value={line.id}
                          />
                          <div className="grid">
                            <label>
                              Proveedor
                              <select
                                name="supplierId"
                                defaultValue={line.supplierId ?? ""}
                              >
                                <option value="">Sin proveedor</option>
                                {data.suppliers
                                  .filter((supplier) => supplier.isActive)
                                  .map((supplier) => (
                                    <option
                                      value={supplier.id}
                                      key={supplier.id}
                                    >
                                      {supplier.name}
                                      {supplier.city
                                        ? " · " + supplier.city
                                        : ""}
                                    </option>
                                  ))}
                              </select>
                            </label>

                            <label>
                              Cantidad total
                              <input
                                name="requestedNativeQuantity"
                                type="number"
                                min="0"
                                step="0.001"
                                defaultValue={
                                  line.requestedNativeQuantity ?? ""
                                }
                              />
                            </label>

                            <label>
                              Cajas / paquetes
                              <input
                                name="packageCount"
                                type="number"
                                min="0"
                                step="0.001"
                                defaultValue={line.packageCount ?? ""}
                              />
                            </label>

                            <label>
                              Nombre empaque
                              <input
                                name="packageName"
                                defaultValue={
                                  line.packageNameSnapshot ?? ""
                                }
                              />
                            </label>

                            <label>
                              Cantidad por empaque
                              <input
                                name="packageQuantity"
                                type="number"
                                min="0"
                                step="0.001"
                                defaultValue={
                                  line.packageQuantitySnapshot ?? ""
                                }
                              />
                            </label>

                            <label>
                              Costo unitario
                              <input
                                name="unitCost"
                                type="number"
                                min="0"
                                step="0.0001"
                                defaultValue={line.unitCostSnapshot ?? ""}
                              />
                            </label>

                            <label>
                              Precio por empaque
                              <input
                                name="packagePrice"
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={
                                  line.packagePriceSnapshot ?? ""
                                }
                              />
                            </label>

                            <label>
                              Gasto real de esta línea
                              <input
                                name="actualTotal"
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={line.actualTotal ?? ""}
                              />
                            </label>

                            <label>
                              Estado
                              <select
                                name="status"
                                defaultValue={line.status}
                              >
                                <option value="PENDING">Pendiente</option>
                                <option value="BOUGHT">Comprado</option>
                                <option value="SKIPPED">Omitido</option>
                              </select>
                            </label>
                          </div>

                          <label>
                            Nota
                            <input
                              name="note"
                              defaultValue={line.note ?? ""}
                            />
                          </label>
                          <button type="submit">
                            Guardar ajuste de línea
                          </button>
                        </form>
                      </details>
                    ))}
                  </div>

                  <form
                    action={addManualPurchaseLine}
                    className="card stack"
                    style={{ marginTop: "1rem" }}
                  >
                    <h3>Agregar compra manual</h3>
                    <input type="hidden" name="planId" value={plan.id} />
                    <div className="grid">
                      <label>
                        Artículo / insumo
                        <input
                          name="itemName"
                          required
                          placeholder="Ej. filtros V60"
                        />
                      </label>
                      <label>
                        Proveedor
                        <select name="supplierId" defaultValue="">
                          <option value="">Sin proveedor</option>
                          {data.suppliers
                            .filter((supplier) => supplier.isActive)
                            .map((supplier) => (
                              <option value={supplier.id} key={supplier.id}>
                                {supplier.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Cantidad
                        <input
                          name="requestedNativeQuantity"
                          type="number"
                          min="0.001"
                          step="0.001"
                        />
                      </label>
                      <label>
                        Costo unitario
                        <input
                          name="unitCost"
                          type="number"
                          min="0"
                          step="0.01"
                        />
                      </label>
                    </div>
                    <label>
                      Nota
                      <input
                        name="note"
                        placeholder="Ej. aprovechar viaje a Puebla"
                      />
                    </label>
                    <button type="submit">Agregar a requisición</button>
                  </form>

                  <form
                    action={updatePurchasePlan}
                    className="stack"
                    style={{ marginTop: "1rem" }}
                  >
                    <input type="hidden" name="planId" value={plan.id} />
                    <div className="grid">
                      <label>
                        Nombre del plan
                        <input
                          name="title"
                          required
                          defaultValue={plan.title}
                        />
                      </label>
                      <label>
                        Destino
                        <input
                          name="destination"
                          defaultValue={plan.destination ?? ""}
                        />
                      </label>
                      <label>
                        Fecha del viaje / compra
                        <input
                          name="plannedFor"
                          type="date"
                          defaultValue={
                            plan.plannedFor
                              ? new Intl.DateTimeFormat("en-CA", {
                                  timeZone: "America/Mexico_City",
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                }).format(plan.plannedFor)
                              : ""
                          }
                        />
                      </label>
                      <label>
                        Estado
                        <select name="status" defaultValue={plan.status}>
                          <option value="DRAFT">Borrador</option>
                          <option value="PLANNED">Planeado</option>
                          <option value="PURCHASED">Comprado</option>
                          <option value="CANCELLED">Cancelado</option>
                        </select>
                      </label>
                      <label>
                        Gasto real
                        <input
                          name="actualSpend"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={plan.actualSpend ?? ""}
                        />
                      </label>
                    </div>
                    <label>
                      Notas
                      <input
                        name="notes"
                        defaultValue={plan.notes ?? ""}
                      />
                    </label>
                    <button type="submit">Actualizar plan</button>
                  </form>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
