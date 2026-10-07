import Link from "next/link";
import {
  assignRoastBatchToBar,
  recordRoastBatch,
  recordRoastSensory,
  saveCoffeeLot,
  saveRoastProfile,
  saveRoastSettings,
} from "./actions";
import { getRoastingDashboard } from "@/src/application/roasting/dashboard";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 2,
});

const restLabels: Record<string, string> = {
  RESTING: "REPOSO",
  READY: "LISTO",
  PRIME: "VENTANA OBJETIVO",
  AGING: "FUERA DE VENTANA",
  UNKNOWN: "SIN REGLA",
};

function mxDateTimeLocal(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "T");
}

function seconds(value: number | null) {
  if (value == null) return "—";
  const min = Math.floor(value / 60);
  const sec = Math.round(value % 60);
  return min + ":" + String(sec).padStart(2, "0");
}

export default async function RoastingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("roast.manage");
  const data = await getRoastingDashboard(organizationId);
  const selectedBatchId =
    typeof params.batch === "string" ? params.batch : null;
  const selectedBatch = selectedBatchId
    ? data.batches.find((batch) => batch.id === selectedBatchId) ?? null
    : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PRODUCCIÓN · TUESTE · CALIDAD</p>
        <h1>Ingeniería de tueste</h1>
        <p className="muted">
          Café verde → perfil → batch → reposo → barra → Espresso QC → cata.
          El objetivo es medir repetibilidad, costo y disponibilidad, no solo
          guardar curvas.
        </p>
      </section>

      {typeof params.error === "string" && (
        <p className="alert">No se pudo guardar: {params.error}</p>
      )}
      {typeof params.saved === "string" && (
        <p className="card status-ok">Registro actualizado.</p>
      )}

      <section className="grid">
        <article className="card">
          <p className="eyebrow">30 DÍAS</p>
          <div className="metric">{data.summary.batches30}</div>
          <p>batches registrados</p>
        </article>
        <article className="card">
          <p className="eyebrow">CAFÉ VERDE · 30 D</p>
          <div className="metric">
            {(data.summary.green30 / 1000).toFixed(2)} kg
          </div>
          <p>cargados al tostador</p>
        </article>
        <article className="card">
          <p className="eyebrow">SALIDA · 30 D</p>
          <div className="metric">
            {(data.summary.roasted30 / 1000).toFixed(2)} kg
          </div>
          <p>café tostado producido</p>
        </article>
        <article className="card">
          <p className="eyebrow">MERMA MEDIA · 30 D</p>
          <div className="metric">
            {data.summary.avgLoss30 == null
              ? "—"
              : data.summary.avgLoss30.toFixed(2) + "%"}
          </div>
          <p>{data.summary.activeLots} lotes activos</p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Inteligencia operativa</h2>
        <p className="muted">
          Las alertas de crash, flick y stall son heurísticas de la curva; se
          deben contrastar con la gráfica y la cata.
        </p>
        {data.recommendations.length === 0 ? (
          <p className="muted">
            No hay alertas automáticas con los datos configurados.
          </p>
        ) : (
          <div className="stack">
            {data.recommendations.map((item, index) => (
              <div className="task" key={item.title + index}>
                <div>
                  <strong>{item.title}</strong>
                  <div
                    className={
                      item.level === "ACTION"
                        ? "status-warn"
                        : "muted"
                    }
                  >
                    {item.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Aprendizaje por reposo</h2>
          <p className="muted">
            Cruza la edad real del batch con los controles de Espresso QC.
            No usa una ventana genérica: aprende de tus propios registros.
          </p>
          <div className="stack">
            {data.restPerformance.map((row) => (
              <div className="task" key={row.key}>
                <strong>{row.key} días</strong>
                <span>
                  {row.samples} QC
                  {row.passRate == null
                    ? ""
                    : " · técnico " + row.passRate.toFixed(0) + "%"}
                  {row.sensoryCorrectRate == null
                    ? ""
                    : " · sensorial " +
                      row.sensoryCorrectRate.toFixed(0) +
                      "%"}
                </span>
              </div>
            ))}
          </div>
          {data.empiricalRest && (
            <p className="status-ok" style={{ marginTop: ".7rem" }}>
              Mejor ventana observada: {data.empiricalRest.key} días · n=
              {data.empiricalRest.samples}
            </p>
          )}
        </article>

        <article className="card">
          <h2>Repetibilidad por perfil</h2>
          <div className="stack">
            {data.profilePerformance.map((row) => (
              <div className="task" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <div className="muted">
                    {row.samples} batch(es)
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {row.fullComplianceRate == null
                    ? "—"
                    : row.fullComplianceRate.toFixed(0) + "% perfil"}
                  <div className="muted">
                    {row.meanAbsDtrDeviation == null
                      ? ""
                      : "ΔDTR " +
                        row.meanAbsDtrDeviation.toFixed(2) +
                        " pp"}
                    {row.meanAbsLossDeviation == null
                      ? ""
                      : " · Δmerma " +
                        row.meanAbsLossDeviation.toFixed(2) +
                        " pp"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card">
          <h2>Café actualmente en barra</h2>
          {data.assignments.length === 0 ? (
            <p className="muted">No hay batches asignados.</p>
          ) : (
            <div className="stack">
              {data.assignments.map((assignment) => (
                <div className="task" key={assignment.id}>
                  <div>
                    <strong>
                      {assignment.barRole} · {assignment.storeName}
                    </strong>
                    <div>
                      {assignment.batch?.lot?.name ?? "Lote"} ·{" "}
                      {assignment.batch?.batchCode}
                    </div>
                    <div className="muted">
                      {assignment.batch
                        ? assignment.batch.ageDays.toFixed(1) +
                          " d post-tueste · " +
                          restLabels[assignment.batch.restState]
                        : "Batch no disponible"}
                      {assignment.batch?.espressoQcCount
                        ? " · QC espresso " +
                          assignment.batch.espressoQcPassRate?.toFixed(0) +
                          "% aprobado"
                        : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <form action={saveRoastSettings} className="card stack">
          <h2>Configuración del tostador</h2>
          <label>
            Tostador
            <input
              name="roasterName"
              defaultValue={data.settings?.roasterName ?? "Skywalker v1"}
            />
          </label>
          <div className="grid">
            <label>
              Potencia nominal (W)
              <input
                name="nominalPowerW"
                type="number"
                min="1"
                step="1"
                defaultValue={data.settings?.nominalPowerW ?? 1000}
                required
              />
            </label>
            <label>
              Electricidad $/kWh
              <input
                name="electricityRatePerKwh"
                type="number"
                min="0"
                step="0.0001"
                defaultValue={
                  data.settings?.electricityRatePerKwh ?? ""
                }
                placeholder="Opcional"
              />
            </label>
            <label>
              Mano de obra $/h
              <input
                name="laborCostPerHour"
                type="number"
                min="0"
                step="0.01"
                defaultValue={data.settings?.laborCostPerHour ?? ""}
                placeholder="Opcional"
              />
            </label>
          </div>
          <label>
            Sucursal para movimientos de producción
            <select
              name="defaultStoreId"
              defaultValue={data.settings?.defaultStoreId ?? ""}
            >
              <option value="">No contabilizar inventario</option>
              {data.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ubicación de producción
            <select
              name="defaultLocationId"
              defaultValue={data.settings?.defaultLocationId ?? ""}
            >
              <option value="">Sin ubicación</option>
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} · {location.type}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Guardar configuración</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Registrar batch</h2>
        <form action={recordRoastBatch} className="stack">
          <div className="grid">
            <label>
              Café
              <select name="coffeeLotId" required defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                {data.lots
                  .filter((lot) => lot.isActive)
                  .map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Perfil
              <select name="profileId" defaultValue="">
                <option value="">Sin perfil</option>
                {data.profiles
                  .filter((profile) => profile.isActive)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Fecha y hora
              <input
                name="roastedAt"
                type="datetime-local"
                defaultValue={mxDateTimeLocal()}
                required
              />
            </label>
            <label>
              Código batch
              <input
                name="batchCode"
                placeholder="Automático si lo dejas vacío"
              />
            </label>
          </div>

          <div className="grid">
            <label>
              Verde (g)
              <input
                name="greenWeightG"
                type="number"
                min="1"
                step="0.1"
                required
              />
            </label>
            <label>
              Tostado final (g)
              <input
                name="roastedWeightG"
                type="number"
                min="1"
                step="0.1"
                required
              />
            </label>
            <label>
              Carga BT (°C)
              <input
                name="chargeTempC"
                type="number"
                step="0.1"
              />
            </label>
          </div>

          <div className="grid">
            <label>
              TP tiempo
              <input
                name="turningPointTimeS"
                placeholder="1:14 o 74"
              />
            </label>
            <label>
              TP BT (°C)
              <input
                name="turningPointTempC"
                type="number"
                step="0.1"
              />
            </label>
            <label>
              Amarilleo tiempo
              <input
                name="yellowingTimeS"
                placeholder="4:10"
              />
            </label>
            <label>
              Amarilleo BT (°C)
              <input
                name="yellowingTempC"
                type="number"
                step="0.1"
              />
            </label>
          </div>

          <div className="grid">
            <label>
              FC tiempo
              <input
                name="firstCrackTimeS"
                placeholder="7:10"
              />
            </label>
            <label>
              FC BT (°C)
              <input
                name="firstCrackTempC"
                type="number"
                step="0.1"
              />
            </label>
            <label>
              Drop tiempo
              <input
                name="dropTimeS"
                placeholder="8:06"
              />
            </label>
            <label>
              Drop BT (°C)
              <input
                name="dropTempC"
                type="number"
                step="0.1"
              />
            </label>
          </div>

          <label>
            Curva CSV opcional
            <textarea
              name="curveCsv"
              rows={7}
              placeholder={"Pega export de Artisan/HiBean con columnas como Time, BT, ET, RoR, Power y Fan.\nEjemplo:\nTime,BT,ET,RoR,Power,Fan\n0:00,25,180,,80,20"}
            />
          </label>
          <label>
            Observaciones
            <textarea
              name="notes"
              rows={3}
              placeholder="Scorching, olor, comportamiento del crack, cambios de potencia/aire..."
            />
          </label>
          <button type="submit">Registrar tueste</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Lotes y pronóstico de producción</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Café</th>
                <th>Uso</th>
                <th>Verde interno</th>
                <th>Tostado POS</th>
                <th>Consumo/día</th>
                <th>Cobertura</th>
                <th>Próximo tueste</th>
                <th>7 días</th>
              </tr>
            </thead>
            <tbody>
              {data.lots.map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <strong>{lot.name}</strong>
                    <div className="muted">
                      {[lot.origin, lot.process, lot.variety]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>{lot.targetUse}</td>
                  <td style={{ textAlign: "right" }}>
                    {lot.greenStockG == null
                      ? "sin mapear"
                      : number.format(lot.greenStockG) + " g"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {lot.loyverseStockG == null
                      ? "sin mapear"
                      : number.format(lot.loyverseStockG) + " g"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {lot.averageDailyUseG == null
                      ? "—"
                      : number.format(lot.averageDailyUseG) + " g"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {lot.daysCover == null
                      ? "—"
                      : lot.daysCover.toFixed(1) + " d"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {lot.recommendedRoastDate ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {lot.batchesFor7d == null
                      ? "—"
                      : lot.batchesFor7d + " batch(es)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid" style={{ marginTop: "1rem" }}>
        <form action={saveCoffeeLot} className="card stack">
          <h2>Nuevo / editar café</h2>
          <label>
            Lote existente
            <select name="lotId" defaultValue="">
              <option value="">Crear nuevo</option>
              {data.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre
            <input name="name" required placeholder="Marsellesa Loma Celosa" />
          </label>
          <div className="grid">
            <label>
              Origen
              <input name="origin" placeholder="Oaxaca" />
            </label>
            <label>
              Finca
              <input name="farm" />
            </label>
            <label>
              Productor
              <input name="producer" />
            </label>
            <label>
              Variedad
              <input name="variety" />
            </label>
            <label>
              Proceso
              <input name="process" />
            </label>
            <label>
              Altitud msnm
              <input name="altitudeMasl" type="number" />
            </label>
          </div>
          <div className="grid">
            <label>
              Uso
              <select name="targetUse" defaultValue="OMNI">
                <option value="ESPRESSO">Espresso</option>
                <option value="FILTER">Filtro</option>
                <option value="OMNI">Omni</option>
              </select>
            </label>
            <label>
              Costo verde $/kg
              <input name="greenCostPerKg" type="number" step="0.01" />
            </label>
            <label>
              Densidad g/L
              <input name="densityGPerL" type="number" step="0.1" />
            </label>
            <label>
              Humedad %
              <input name="moisturePct" type="number" step="0.01" />
            </label>
          </div>
          <div className="grid">
            <label>
              Reposo mínimo d
              <input name="minRestDays" type="number" defaultValue={4} />
            </label>
            <label>
              Ventana objetivo desde d
              <input name="peakRestDays" type="number" defaultValue={10} />
            </label>
            <label>
              Ventana máxima d
              <input name="maxRestDays" type="number" defaultValue={30} />
            </label>
          </div>
          <label>
            Inventario café verde
            <select name="greenInventoryItemId" defaultValue="">
              <option value="">Sin mapear</option>
              {data.inventoryItems
                .filter((item) => item.canonicalUnit === "g")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.category}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Inventario café tostado interno
            <select name="roastedInventoryItemId" defaultValue="">
              <option value="">Sin mapear</option>
              {data.inventoryItems
                .filter((item) => item.canonicalUnit === "g")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.category}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Insumo tostado en Loyverse
            <select
              name="loyverseRoastedVariantExternalId"
              defaultValue=""
            >
              <option value="">Sin mapear</option>
              {data.loyverseVariants.map((row) => (
                <option
                  key={row.variantExternalId}
                  value={row.variantExternalId}
                >
                  {row.itemName} · stock {number.format(row.inStock)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Multiplicador Loyverse → gramos
            <input
              name="loyverseUnitToG"
              type="number"
              min="0.000001"
              step="0.001"
              defaultValue={1000}
            />
          </label>
          <label>
            Notas
            <textarea name="notes" rows={3} />
          </label>
          <button type="submit">Guardar café</button>
        </form>

        <form action={saveRoastProfile} className="card stack">
          <h2>Perfil objetivo</h2>
          <label>
            Perfil existente
            <select name="profileId" defaultValue="">
              <option value="">Crear nuevo</option>
              {data.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Café
            <select name="coffeeLotId" defaultValue="">
              <option value="">General</option>
              {data.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre
            <input name="name" required placeholder="Espresso v1" />
          </label>
          <input
            type="hidden"
            name="roasterName"
            value={data.settings?.roasterName ?? "Skywalker v1"}
          />
          <div className="grid">
            <label>
              Uso
              <select name="targetUse" defaultValue="OMNI">
                <option value="ESPRESSO">Espresso</option>
                <option value="FILTER">Filtro</option>
                <option value="OMNI">Omni</option>
              </select>
            </label>
            <label>
              Batch verde (g)
              <input name="batchSizeG" type="number" step="0.1" />
            </label>
            <label>
              Carga (°C)
              <input name="chargeTempC" type="number" step="0.1" />
            </label>
          </div>
          <div className="grid">
            <label>
              Amarilleo
              <input name="targetYellowingS" placeholder="4:10" />
            </label>
            <label>
              FC
              <input name="targetFirstCrackS" placeholder="7:10" />
            </label>
            <label>
              FC °C
              <input
                name="targetFirstCrackTempC"
                type="number"
                step="0.1"
              />
            </label>
            <label>
              Drop
              <input name="targetDropS" placeholder="8:20" />
            </label>
            <label>
              Drop °C
              <input
                name="targetDropTempC"
                type="number"
                step="0.1"
              />
            </label>
          </div>
          <div className="grid">
            <label>
              DTR objetivo %
              <input name="targetDtrPct" type="number" step="0.1" />
            </label>
            <label>
              Tolerancia DTR ±%
              <input
                name="dtrTolerancePct"
                type="number"
                step="0.1"
                defaultValue={2}
              />
            </label>
            <label>
              Merma objetivo %
              <input
                name="targetWeightLossPct"
                type="number"
                step="0.1"
              />
            </label>
            <label>
              Tolerancia merma ±%
              <input
                name="weightLossTolerancePct"
                type="number"
                step="0.1"
                defaultValue={2}
              />
            </label>
            <label>
              Tolerancia tiempo ±s
              <input
                name="timeToleranceS"
                type="number"
                defaultValue={20}
              />
            </label>
          </div>
          <label>
            Notas del perfil
            <textarea name="notes" rows={3} />
          </label>
          <button type="submit">Guardar perfil</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Historial de batches</h2>
        <div className="stack">
          {data.batches.slice(0, 30).map((batch) => (
            <article className="task" key={batch.id}>
              <div style={{ flex: 1 }}>
                <div>
                  <strong>
                    {batch.batchCode} · {batch.lot?.name ?? "Lote"}
                  </strong>{" "}
                  <span
                    className={
                      batch.profileCheckCount > 0 &&
                      batch.profilePassCount < batch.profileCheckCount
                        ? "status-warn"
                        : "status-ok"
                    }
                  >
                    {batch.profileCheckCount > 0
                      ? batch.profilePassCount +
                        "/" +
                        batch.profileCheckCount +
                        " perfil"
                      : "sin perfil"}
                  </span>
                </div>
                <div>
                  {batch.greenWeightG} g → {batch.roastedWeightG} g · merma{" "}
                  {Number(batch.weightLossPct).toFixed(2)}%
                  {batch.dtrPct
                    ? " · DTR " + Number(batch.dtrPct).toFixed(2) + "%"
                    : ""}
                </div>
                <div className="muted">
                  FC {seconds(batch.firstCrackTimeS)} · drop{" "}
                  {seconds(batch.dropTimeS)} ·{" "}
                  {batch.ageDays.toFixed(1)} d post-tueste ·{" "}
                  {restLabels[batch.restState]}
                  {batch.energyKwh != null
                    ? " · " + batch.energyKwh.toFixed(3) + " kWh"
                    : ""}
                  {batch.roastedCostPerKg != null
                    ? " · " +
                      money.format(batch.roastedCostPerKg) +
                      "/kg estimado"
                    : ""}
                </div>
                {(batch.diagnostics.crashFlag ||
                  batch.diagnostics.flickFlag ||
                  batch.diagnostics.stallFlag) && (
                  <div className="status-warn">
                    Curva:{" "}
                    {[
                      batch.diagnostics.crashFlag ? "crash" : null,
                      batch.diagnostics.flickFlag ? "flick" : null,
                      batch.diagnostics.stallFlag ? "stall" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                {batch.latestSensory && (
                  <div className="muted">
                    Última cata:{" "}
                    {batch.latestSensory.descriptors || "sin descriptores"}
                    {batch.latestSensory.defects
                      ? " · defectos: " + batch.latestSensory.defects
                      : ""}
                  </div>
                )}
              </div>
              <Link href={"/admin/roasting?batch=" + batch.id}>
                <button>Analizar</button>
              </Link>
            </article>
          ))}
        </div>
      </section>

      {selectedBatch && (
        <section className="grid" style={{ marginTop: "1rem" }}>
          <article className="card">
            <p className="eyebrow">ANÁLISIS DE BATCH</p>
            <h2>{selectedBatch.batchCode}</h2>
            <p>
              {selectedBatch.lot?.name} ·{" "}
              {selectedBatch.profile?.name ?? "sin perfil"}
            </p>
            <div className="grid">
              <div>
                <strong>Merma</strong>
                <div className="metric">
                  {Number(selectedBatch.weightLossPct).toFixed(2)}%
                </div>
              </div>
              <div>
                <strong>DTR</strong>
                <div className="metric">
                  {selectedBatch.dtrPct
                    ? Number(selectedBatch.dtrPct).toFixed(2) + "%"
                    : "—"}
                </div>
              </div>
              <div>
                <strong>Reposo</strong>
                <div className="metric">
                  {selectedBatch.ageDays.toFixed(1)} d
                </div>
              </div>
              <div>
                <strong>QC espresso</strong>
                <div className="metric">
                  {selectedBatch.espressoQcPassRate == null
                    ? "—"
                    : selectedBatch.espressoQcPassRate.toFixed(0) + "%"}
                </div>
              </div>
            </div>
            <p className="muted">
              Perfil: {selectedBatch.profilePassCount}/
              {selectedBatch.profileCheckCount} variables dentro de
              tolerancia. Inventario{" "}
              {selectedBatch.inventoryPosted
                ? "contabilizado"
                : "no contabilizado automáticamente"}.
            </p>

            {selectedBatch.diagnostics.peakRor != null && (
              <div className="stack">
                <div className="task">
                  <span>RoR pico</span>
                  <strong>
                    {selectedBatch.diagnostics.peakRor.toFixed(1)} °C/min
                  </strong>
                </div>
                <div className="task">
                  <span>RoR en FC</span>
                  <strong>
                    {selectedBatch.diagnostics.rorAtFirstCrack?.toFixed(
                      1,
                    ) ?? "—"}
                  </strong>
                </div>
                <div className="task">
                  <span>Crash heurístico</span>
                  <strong>
                    {selectedBatch.diagnostics.crashMagnitude?.toFixed(
                      1,
                    ) ?? "—"}{" "}
                    °C/min
                  </strong>
                </div>
                <div className="task">
                  <span>Flick heurístico</span>
                  <strong>
                    {selectedBatch.diagnostics.flickMagnitude?.toFixed(
                      1,
                    ) ?? "—"}{" "}
                    °C/min
                  </strong>
                </div>
              </div>
            )}

            {selectedBatch.estimatedBatchCost != null && (
              <p>
                Costo estimado batch{" "}
                <strong>
                  {money.format(selectedBatch.estimatedBatchCost)}
                </strong>
                {selectedBatch.greenCost != null
                  ? " · verde " + money.format(selectedBatch.greenCost)
                  : ""}
                {selectedBatch.energyCost != null
                  ? " · energía " +
                    money.format(selectedBatch.energyCost)
                  : ""}
                {selectedBatch.laborCost != null
                  ? " · operación " +
                    money.format(selectedBatch.laborCost)
                  : ""}
              </p>
            )}
          </article>

          <form action={recordRoastSensory} className="card stack">
            <h2>Registrar cata</h2>
            <input
              type="hidden"
              name="roastBatchId"
              value={selectedBatch.id}
            />
            <label>
              Método
              <select name="brewMethod" defaultValue="CUPPING">
                <option value="CUPPING">Cupping</option>
                <option value="ESPRESSO">Espresso</option>
                <option value="V60">V60</option>
                <option value="ORIGAMI">Origami</option>
                <option value="OTRO">Otro</option>
              </select>
            </label>
            <div className="grid">
              {[
                ["aroma", "Aroma"],
                ["acidity", "Acidez"],
                ["sweetness", "Dulzor"],
                ["body", "Cuerpo"],
                ["bitterness", "Amargor"],
                ["aftertaste", "Retrogusto"],
                ["balance", "Balance"],
              ].map(([name, label]) => (
                <label key={name}>
                  {label} 0–10
                  <input
                    name={name}
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                  />
                </label>
              ))}
            </div>
            <label>
              Puntaje global 0–100
              <input
                name="overallScore"
                type="number"
                min="0"
                max="100"
                step="0.25"
              />
            </label>
            <label>
              Descriptores
              <input
                name="descriptors"
                placeholder="Durazno, jazmín, cereza, caramelo..."
              />
            </label>
            <label>
              Defectos / alertas
              <input
                name="defects"
                placeholder="Herbal, áspero, amargor persistente..."
              />
            </label>
            <label>
              Notas
              <textarea name="notes" rows={3} />
            </label>
            <button type="submit">Guardar cata</button>
          </form>

          <form action={assignRoastBatchToBar} className="card stack">
            <h2>Enviar a barra</h2>
            <input
              type="hidden"
              name="roastBatchId"
              value={selectedBatch.id}
            />
            <p className="muted">
              El Espresso QC se vinculará automáticamente con el batch activo
              en la posición ESPRESSO.
            </p>
            <label>
              Sucursal
              <select name="storeId" required defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                {data.stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Posición
              <select name="barRole" defaultValue="ESPRESSO">
                <option value="ESPRESSO">Espresso</option>
                <option value="FILTER_A">Filtro A</option>
                <option value="FILTER_B">Filtro B</option>
              </select>
            </label>
            <label>
              Nota
              <input name="note" placeholder="Tolva principal, brew bar..." />
            </label>
            <button type="submit">Asignar batch</button>
          </form>
        </section>
      )}

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin">← Volver a Admin</Link>
      </p>
    </main>
  );
}
