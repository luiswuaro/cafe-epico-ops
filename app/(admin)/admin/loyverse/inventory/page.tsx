import Link from "next/link";
import {
  createInventoryItemFromLoyverse,
  importLoyverseStockAsTheoretical,
  removeLoyverseInventoryMapping,
  saveLoyverseInventoryMapping,
} from "./actions";
import { getLoyverseInventoryMappingAdmin } from "@/src/application/loyverse/inventory-mapping";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

const presetLabels: Record<string, string> = {
  PIECE: "Pieza → pz",
  KG_TO_G: "kg → g",
  G_TO_G: "g → g",
  L_TO_ML: "L → ml",
  ML_TO_ML: "ml → ml",
  CUSTOM: "Personalizado",
};

function presetsForUnit(unit: string) {
  if (unit === "pz") {
    return [{ value: "PIECE", label: "Pieza → pz" }];
  }
  if (unit === "g") {
    return [
      { value: "KG_TO_G", label: "kg → g" },
      { value: "G_TO_G", label: "g → g" },
    ];
  }
  return [
    { value: "L_TO_ML", label: "L → ml" },
    { value: "ML_TO_ML", label: "ml → ml" },
  ];
}

function suggestedPreset(
  canonicalUnit: string,
  soldByWeight: boolean,
) {
  if (canonicalUnit === "pz") return "PIECE";
  if (canonicalUnit === "g") {
    return soldByWeight ? "KG_TO_G" : "G_TO_G";
  }
  return soldByWeight ? "L_TO_ML" : "ML_TO_ML";
}

export default async function LoyverseInventoryMappingPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { employee } = await getCurrentEmployee();

  if (!employee.homeStoreId) {
    return (
      <main className="shell">
        <p className="alert">Empleado sin sucursal asignada.</p>
      </main>
    );
  }

  await Promise.all([
    assertEmployeePermission(
      employee.id,
      "integration.manage",
      employee.homeStoreId,
    ),
    assertEmployeePermission(
      employee.id,
      "inventory.adjust",
      employee.homeStoreId,
    ),
  ]);

  const data = await getLoyverseInventoryMappingAdmin(
    employee.organizationId,
    employee.homeStoreId,
  );

  const imported =
    typeof params.imported === "string" ? params.imported : null;
  const unchanged =
    typeof params.unchanged === "string" ? params.unchanged : null;
  const missing =
    typeof params.missing === "string" ? params.missing : null;
  const error = typeof params.error === "string" ? params.error : null;

  const defaultExternalStore = data.externalStores[0]?.externalId ?? "";

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ADMIN · LOYVERSE · INVENTARIO</p>
        <h1>Cómo medimos el inventario</h1>
        <p className="muted">
          Loyverse puede guardar existencias por pieza o como cantidades
          fraccionarias. Aquí definimos una sola vez cómo convertirlas a las
          unidades de Café Épico Ops.
        </p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/admin/loyverse">← Volver a Loyverse</Link>
        </p>
      </section>

      {error && <p className="alert">{error}</p>}

      {imported != null && (
        <p className="card status-ok">
          Importación terminada · actualizados {imported} · sin cambio{" "}
          {unchanged ?? "0"} · sin existencia Loyverse {missing ?? "0"}.
        </p>
      )}

      <section className="grid">
        <article className="card">
          <span className="pill">1 · VINCULAR</span>
          <div className="metric">{data.preview.length}</div>
          <p>insumos ya conectados con Loyverse.</p>
        </article>

        <article className="card">
          <span className="pill">CATÁLOGO OPS</span>
          <div className="metric">{data.internalItems.length}</div>
          <p>insumos internos disponibles.</p>
        </article>

        <article className="card">
          <span className="pill">FUENTES LOYVERSE</span>
          <div className="metric">{data.candidates.length}</div>
          <p>
            ingredientes o artículos con stock detectados como candidatos.
          </p>
        </article>
      </section>

      {data.externalStores.length === 0 && (
        <p className="alert">
          Primero sincroniza Tiendas en Admin → Loyverse.
        </p>
      )}

      {data.exactNameSuggestions.length > 0 && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <p className="eyebrow">SUGERENCIAS</p>
          <h2>Coincidencias claras por nombre</h2>
          <p className="muted">
            Solo sugerimos cuando existe una coincidencia única. Tú decides la
            ubicación y confirmas cómo se mide.
          </p>

          <div className="stack" style={{ marginTop: "1rem" }}>
            {data.exactNameSuggestions.map((suggestion) => {
              const preset = suggestedPreset(
                suggestion.canonicalUnit,
                suggestion.candidate.soldByWeight,
              );

              return (
                <form
                  action={saveLoyverseInventoryMapping}
                  className="task"
                  key={suggestion.inventoryItemId}
                >
                  <input
                    type="hidden"
                    name="inventoryItemId"
                    value={suggestion.inventoryItemId}
                  />
                  <input
                    type="hidden"
                    name="loyverseVariantExternalId"
                    value={suggestion.candidate.variantExternalId}
                  />
                  <input
                    type="hidden"
                    name="loyverseStoreExternalId"
                    value={defaultExternalStore}
                  />

                  <div style={{ flex: 1 }}>
                    <strong>{suggestion.inventoryItemName}</strong>
                    <div className="muted">
                      ↔ {suggestion.candidate.itemName}
                      {suggestion.candidate.sku
                        ? ` · SKU ${suggestion.candidate.sku}`
                        : ""}
                      {" · "}
                      {suggestion.candidate.soldByWeight
                        ? "Loyverse: fraccionario"
                        : "Loyverse: unidad"}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: ".5rem",
                        flexWrap: "wrap",
                        marginTop: ".5rem",
                      }}
                    >
                      <label>
                        Ubicación
                        <select name="locationId" required defaultValue="">
                          <option value="" disabled>
                            Selecciona…
                          </option>
                          {data.locations.map((location) => (
                            <option value={location.id} key={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Medición
                        <select name="preset" defaultValue={preset} required>
                          {presetsForUnit(suggestion.canonicalUnit).map(
                            (option) => (
                              <option
                                value={option.value}
                                key={option.value}
                              >
                                {option.label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                  </div>

                  <button type="submit">Vincular</button>
                </form>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={saveLoyverseInventoryMapping} className="card stack">
          <p className="eyebrow">MAPEO MANUAL</p>
          <h2>Mapear insumo existente</h2>

          <label>
            Insumo Café Épico Ops
            <select name="inventoryItemId" required defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {data.internalItems.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.canonicalUnit}
                </option>
              ))}
            </select>
          </label>

          <label>
            Artículo / ingrediente Loyverse
            <select
              name="loyverseVariantExternalId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {data.candidates.map((candidate) => (
                <option
                  value={candidate.variantExternalId}
                  key={candidate.variantExternalId}
                >
                  {candidate.itemName}
                  {candidate.sku ? ` · ${candidate.sku}` : ""}
                  {candidate.soldByWeight
                    ? " · fraccionario"
                    : " · unidad"}
                </option>
              ))}
            </select>
          </label>

          <label>
            Ubicación
            <select name="locationId" required defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {data.locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Cómo se mide
            <select name="preset" required defaultValue="PIECE">
              <option value="PIECE">Pieza → pz</option>
              <option value="KG_TO_G">kg → g</option>
              <option value="G_TO_G">g → g</option>
              <option value="L_TO_ML">L → ml</option>
              <option value="ML_TO_ML">ml → ml</option>
            </select>
          </label>

          {data.externalStores.length === 1 ? (
            <input
              type="hidden"
              name="loyverseStoreExternalId"
              value={defaultExternalStore}
            />
          ) : (
            <label>
              Tienda Loyverse
              <select
                name="loyverseStoreExternalId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {data.externalStores.map((store) => (
                  <option value={store.externalId} key={store.externalId}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button type="submit">Guardar mapeo</button>
          <p className="muted">
            Si la medición elegida no coincide con la unidad interna, el
            sistema la rechaza.
          </p>
        </form>

        <form action={createInventoryItemFromLoyverse} className="card stack">
          <p className="eyebrow">AMPLIAR CATÁLOGO</p>
          <h2>Crear insumo desde Loyverse</h2>
          <p className="muted">
            Úsalo cuando el ingrediente existe en Loyverse pero todavía no
            existe entre los {data.internalItems.length} insumos de Ops.
          </p>

          <label>
            Artículo / ingrediente Loyverse
            <select
              name="loyverseVariantExternalId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {data.candidates
                .filter(
                  (candidate) =>
                    !data.mappedVariantIds.has(
                      candidate.variantExternalId,
                    ),
                )
                .map((candidate) => (
                  <option
                    value={candidate.variantExternalId}
                    key={candidate.variantExternalId}
                  >
                    {candidate.itemName}
                    {candidate.sku ? ` · ${candidate.sku}` : ""}
                    {candidate.soldByWeight
                      ? " · fraccionario"
                      : " · unidad"}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Ubicación
            <select name="locationId" required defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {data.locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Cómo se medirá en Ops
            <select name="preset" required defaultValue="PIECE">
              <option value="PIECE">Pieza → pz</option>
              <option value="KG_TO_G">kg → g</option>
              <option value="G_TO_G">g → g</option>
              <option value="L_TO_ML">L → ml</option>
              <option value="ML_TO_ML">ml → ml</option>
            </select>
          </label>

          {data.externalStores.length === 1 ? (
            <input
              type="hidden"
              name="loyverseStoreExternalId"
              value={defaultExternalStore}
            />
          ) : (
            <label>
              Tienda Loyverse
              <select
                name="loyverseStoreExternalId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {data.externalStores.map((store) => (
                  <option value={store.externalId} key={store.externalId}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button type="submit">Crear y vincular</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <p className="eyebrow">2 · REVISAR</p>
        <h2>Existencias antes de importar</h2>
        <p className="muted">
          “Convertido” es la existencia Loyverse llevada a g, ml o pz. “Δ a
          aplicar” es lo que cambiaría el teórico de Ops.
        </p>

        {data.preview.length === 0 ? (
          <p className="muted">Todavía no hay insumos vinculados.</p>
        ) : (
          <div className="stack" style={{ marginTop: "1rem" }}>
            {data.preview.map((row) => (
              <div className="task" key={row.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <strong>{row.itemName}</strong>{" "}
                    <span className="pill">
                      {row.sourceMode === "UNIT"
                        ? "UNIDAD"
                        : "FRACCIONARIO"}
                    </span>
                  </div>
                  <div className="muted">
                    {row.loyverseItemName}
                    {row.loyverseSku ? ` · SKU ${row.loyverseSku}` : ""}
                    {" · "}
                    {row.locationName}
                    {" · "}
                    {presetLabels[row.preset] ?? row.preset}
                  </div>
                  <div style={{ marginTop: ".35rem" }}>
                    Loyverse:{" "}
                    <strong>
                      {row.loyverseQuantity == null
                        ? "—"
                        : `${number.format(row.loyverseQuantity)} ${row.sourceUnit}`}
                    </strong>
                    {" · "}
                    Convertido:{" "}
                    <strong>
                      {row.convertedQuantity == null
                        ? "—"
                        : `${number.format(row.convertedQuantity)} ${row.canonicalUnit}`}
                    </strong>
                    {" · "}
                    Ops teórico:{" "}
                    <strong>
                      {number.format(row.theoreticalQuantity)}{" "}
                      {row.canonicalUnit}
                    </strong>
                    {" · "}
                    Δ a aplicar:{" "}
                    <strong>
                      {row.delta == null
                        ? "—"
                        : `${row.delta > 0 ? "+" : ""}${number.format(
                            row.delta,
                          )} ${row.canonicalUnit}`}
                    </strong>
                  </div>
                  {row.levelSyncedAt && (
                    <div className="muted">
                      Stock Loyverse sincronizado{" "}
                      {row.levelSyncedAt.toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                  )}
                </div>

                <form action={removeLoyverseInventoryMapping}>
                  <input type="hidden" name="mappingId" value={row.id} />
                  <button type="submit">Quitar</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <form
        action={importLoyverseStockAsTheoretical}
        className="card stack"
        style={{ marginTop: "1rem" }}
      >
        <p className="eyebrow">3 · IMPORTAR EXISTENCIAS</p>
        <h2>Sincronizar e importar teórico</h2>
        <p>
          Un solo clic consulta las existencias actuales de Loyverse y luego
          lleva cada insumo mapeado al valor convertido mostrado arriba.
        </p>
        <p className="muted">
          No cambia conteos físicos. No borra movimientos anteriores. La
          diferencia se registra como saldo inicial o ajuste manual auditable.
        </p>
        {data.preview.length === 0 && (
          <p className="status-warn">
            Primero vincula al menos un insumo. Loyverse ya puede tener
            existencias sincronizadas, pero sin mapeo no sabemos si deben
            convertirse a g, ml o pz.
          </p>
        )}
        <button type="submit" disabled={data.preview.length === 0}>
          Sincronizar + importar inventario ahora
        </button>
      </form>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Regla rápida</h2>
        <p>
          <strong>Pieza:</strong> 12 latas = 12 pz.{" "}
          <strong>kg → g:</strong> 0.050 kg = 50 g.{" "}
          <strong>L → ml:</strong> 0.250 L = 250 ml.
        </p>
        <p className="muted">
          El factor se guarda internamente para que recetas, inventario
          teórico y gráficos hablen siempre la misma unidad.
        </p>
      </section>
    </main>
  );
}
