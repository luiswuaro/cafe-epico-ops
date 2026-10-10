import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { confirmHiBeanRoastImport } from "../../import-actions";
import { parseRoastCurveInput } from "@/src/domain/roasting/curve";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances,
  roastCoffeeLots,
  roastImportDrafts,
  roastProfiles,
  roastSettings,
} from "@/src/infrastructure/db/schema";

export const dynamic = "force-dynamic";

function fmtSeconds(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function fmtNumber(value: number | undefined | null, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: digits,
  }).format(value);
}

function localDateInput(value: string | undefined) {
  if (!value) return "";
  return value.slice(0, 16);
}

export default async function HiBeanImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { draftId } = await params;
  const query = await searchParams;
  const { organizationId } = await requirePermission("roast.manage");
  const db = getDb();

  const [[draft], lots, profiles] = await Promise.all([
    db
      .select()
      .from(roastImportDrafts)
      .where(
        and(
          eq(roastImportDrafts.id, draftId),
          eq(roastImportDrafts.organizationId, organizationId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(roastCoffeeLots)
      .where(eq(roastCoffeeLots.organizationId, organizationId)),
    db
      .select()
      .from(roastProfiles)
      .where(eq(roastProfiles.organizationId, organizationId)),
  ]);

  if (!draft) notFound();

  const parsed = parseRoastCurveInput(JSON.stringify(draft.rawPayload));
  const metadata = parsed.metadata;
  if (
    parsed.format !== "JSON_HIBEAN" ||
    metadata?.provider !== "HIBEAN"
  ) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">IMPORTACIÓN HIBEAN</p>
          <h1>El archivo ya no puede interpretarse</h1>
          <p className="status-warn">
            El borrador existe, pero el parser no reconoce su estructura.
          </p>
          <Link href="/admin/roasting">← Volver a Tueste</Link>
        </section>
      </main>
    );
  }

  if (draft.status === "CONFIRMED" && draft.confirmedBatchId) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">IMPORTACIÓN HIBEAN · YA REGISTRADA</p>
          <h1>Este archivo ya fue confirmado</h1>
          <p>
            Ops detectó el mismo archivo por su huella digital y no va a crear
            otro batch.
          </p>
          <Link href={"/admin/roasting?batch=" + draft.confirmedBatchId}>
            <button>Ver batch registrado</button>
          </Link>
        </section>
      </main>
    );
  }

  const bean = metadata.bean;
  const events = parsed.events ?? {};
  const reportedInventoryG = bean?.remainingInventoryG ?? null;
  const matchedLot =
    lots.find((lot) => lot.id === draft.matchedCoffeeLotId) ?? null;

  // El JSON puede conservar un saldo anterior al descuento del tostador.
  // OPS proyecta el saldo posterior usando la dosis real del batch.
  const [settings] = await db.select()
    .from(roastSettings)
    .where(eq(roastSettings.organizationId, organizationId))
    .limit(1);
  let currentOpsGreenG: number | null = null;
  if (matchedLot?.greenInventoryItemId &&
      settings?.defaultStoreId && settings.defaultLocationId) {
    const [balance] = await db.select({
      quantity: inventoryBalances.theoreticalQuantity,
    }).from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId, organizationId),
      eq(inventoryBalances.storeId, settings.defaultStoreId),
      eq(inventoryBalances.locationId, settings.defaultLocationId),
      eq(inventoryBalances.inventoryItemId, matchedLot.greenInventoryItemId),
    )).limit(1);
    currentOpsGreenG = Number(balance?.quantity ?? 0);
  }
  const expectedAfterBatchG = currentOpsGreenG != null &&
    metadata.greenWeightG != null
      ? currentOpsGreenG - metadata.greenWeightG
      : null;

  const developmentTimeS =
    events.firstCrack?.tS != null && events.drop?.tS != null
      ? events.drop.tS - events.firstCrack.tS
      : null;
  const dtrPct =
    developmentTimeS != null &&
    events.drop?.tS != null &&
    events.drop.tS > 0
      ? (developmentTimeS / events.drop.tS) * 100
      : null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">SMART ROAST IMPORT · HIBEAN</p>
        <h1>Confirma el batch y el inventario</h1>
        <p className="muted">
          HiBean propone los datos. Nada modifica el inventario verde de Ops
          hasta que confirmes esta pantalla. Al confirmar, la carga verde se
          descontará una sola vez del inventario OPS vinculado al lote.
        </p>
      </section>

      {query.duplicate === "1" && (
        <p className="card status-warn">
          Este archivo ya había sido cargado anteriormente.
        </p>
      )}
      {typeof query.error === "string" && (
        <p className="alert">
          No se pudo confirmar: {query.error}
        </p>
      )}

      <section className="grid">
        <article className="card">
          <p className="eyebrow">ARCHIVO</p>
          <h2>{draft.sourceFileName}</h2>
          <p>
            Formato <strong>HiBean / Skywalker</strong> ·{" "}
            {parsed.points.length} muestras
          </p>
          <p className="muted">
            Roast ID: {metadata.externalRoastId ?? metadata.localRoastId ?? "—"}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">CAFÉ DETECTADO</p>
          <h2>{bean?.name ?? metadata.title ?? "Sin nombre"}</h2>
          <p>
            {bean?.regionCode ?? bean?.origin ?? "Origen no indicado"}
            {bean?.altitudeRange ? " · " + bean.altitudeRange + " msnm" : ""}
          </p>
          <p className="muted">
            HiBean bean ID: {bean?.cloudId ?? "—"}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">INVENTARIO HIBEAN</p>
          <div className="metric">
            {reportedInventoryG == null
              ? "—"
              : fmtNumber(reportedInventoryG, 0) + " g"}
          </div>
          <p>existencia reportada dentro del JSON</p>
          <p className="muted">
            {bean?.inventoryEnabled
              ? "Control de inventario activo en HiBean."
              : "HiBean no marca inventario como activo."}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">MATCH EN OPS</p>
          <h2>{matchedLot?.name ?? "Requiere confirmación"}</h2>
          {matchedLot?.hibeanGreenInventoryG != null && (
            <p>
              Último confirmado:{" "}
              <strong>
                {fmtNumber(Number(matchedLot.hibeanGreenInventoryG), 0)} g
              </strong>
            </p>
          )}
          <p className="muted">
            La coincidencia por nombre es solo sugerencia hasta confirmar.
          </p>
        </article>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <p className="eyebrow">EVENTOS DETECTADOS</p>
        <h2>El JSON ya trae la estructura del roast</h2>
        <div className="grid">
          <div className="task">
            <strong>Carga</strong>
            <span>
              {fmtSeconds(events.charge?.tS)} ·{" "}
              {fmtNumber(events.charge?.btC)} °C
            </span>
          </div>
          <div className="task">
            <strong>TP</strong>
            <span>
              {fmtSeconds(events.turningPoint?.tS)} ·{" "}
              {fmtNumber(events.turningPoint?.btC)} °C
            </span>
          </div>
          <div className="task">
            <strong>Amarilleo</strong>
            <span>
              {fmtSeconds(events.yellowing?.tS)} ·{" "}
              {fmtNumber(events.yellowing?.btC)} °C
            </span>
          </div>
          <div className="task">
            <strong>FC</strong>
            <span>
              {fmtSeconds(events.firstCrack?.tS)} ·{" "}
              {fmtNumber(events.firstCrack?.btC)} °C
            </span>
          </div>
          <div className="task">
            <strong>Drop</strong>
            <span>
              {fmtSeconds(events.drop?.tS)} ·{" "}
              {fmtNumber(events.drop?.btC)} °C
            </span>
          </div>
          <div className="task">
            <strong>Desarrollo / DTR</strong>
            <span>
              {fmtSeconds(developmentTimeS)} ·{" "}
              {dtrPct == null ? "—" : dtrPct.toFixed(2) + "%"}
            </span>
          </div>
        </div>
      </section>

      <form
        action={confirmHiBeanRoastImport}
        className="card stack"
        style={{ marginTop: "1rem" }}
      >
        <input type="hidden" name="draftId" value={draft.id} />

        <p className="eyebrow">1 · VINCULAR CAFÉ</p>
        <label>
          Café en Café Épico Ops
          <select
            name="coffeeLotId"
            defaultValue={matchedLot?.id ?? "__CREATE__"}
            required
          >
            <option value="__CREATE__">
              Crear nuevo desde HiBean: {bean?.name ?? "café sin nombre"}
            </option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.name}
                {lot.hibeanBeanCloudId === bean?.cloudId
                  ? " · HIBEAN VINCULADO"
                  : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Nombre si se crea un café nuevo
          <input
            name="newLotName"
            defaultValue={bean?.name ?? metadata.title ?? ""}
          />
        </label>

        {bean?.cloudId && (
          <label>
            <input
              type="checkbox"
              name="linkHibeanBean"
              value="yes"
              defaultChecked
            />{" "}
            Recordar que HiBean bean {bean.cloudId} corresponde a este café.
          </label>
        )}

        <p className="eyebrow" style={{ marginTop: ".5rem" }}>
          2 · CONFIRMAR INVENTARIO VERDE
        </p>
        <div className="grid">
          <label>
            HiBean reporta (g)
            <input
              value={
                reportedInventoryG == null
                  ? ""
                  : String(reportedInventoryG)
              }
              readOnly
            />
          </label>
          <label>
            Existencia verde después de este tueste (g)
            <input
              name="confirmedInventoryG"
              type="number"
              min="0"
              step="0.1"
              required
              defaultValue={
                expectedAfterBatchG != null
                  ? Math.max(0, expectedAfterBatchG)
                  : reportedInventoryG ?? ""
              }
            />
          </label>
        </div>
        {expectedAfterBatchG != null && (
          <p className="muted">
            Inventario OPS actual: <strong>{fmtNumber(currentOpsGreenG, 0)} g</strong>.
            Dosis verde del batch: <strong>{fmtNumber(metadata.greenWeightG, 0)} g</strong>.
            Existencia posterior prevista: <strong>{fmtNumber(expectedAfterBatchG, 0)} g</strong>.
            Verifica contra el conteo físico. El número importado de HiBean
            es informativo y puede estar desactualizado.
          </p>
        )}
        <label>
          Nota de corrección de inventario
          <input
            name="inventoryNote"
            placeholder="Ej. Saldo HiBean del JSON desactualizado; se confirma saldo final."
          />
        </label>
        <label className="card">
          <input
            type="checkbox"
            name="inventoryConfirmed"
            value="yes"
            required
          />{" "}
          <strong>
            Confirmo la existencia final de café verde, después de consumir
            la carga de este tueste.
          </strong>
        </label>

        <p className="eyebrow" style={{ marginTop: ".5rem" }}>
          3 · COMPLETAR BATCH
        </p>
        <div className="grid">
          <label>
            Fecha y hora
            <input
              name="roastedAt"
              type="datetime-local"
              required
              defaultValue={localDateInput(metadata.roastedAt)}
            />
          </label>
          <label>
            Perfil
            <select name="profileId" defaultValue="">
              <option value="">Sin perfil</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Peso verde (g)
            <input
              name="greenWeightG"
              type="number"
              step="0.1"
              min="0.1"
              required
              defaultValue={metadata.greenWeightG ?? ""}
            />
          </label>
          <label>
            Peso tostado final (g)
            <input
              name="roastedWeightG"
              type="number"
              step="0.1"
              min="0.1"
              required
              defaultValue={metadata.roastedWeightG ?? ""}
              placeholder="Pésalo al terminar"
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

        <details>
          <summary style={{ cursor: "pointer" }}>
            Revisar o corregir eventos detectados
          </summary>
          <div className="grid" style={{ marginTop: ".7rem" }}>
            <label>
              Carga BT °C
              <input
                name="chargeTempC"
                type="number"
                step="0.1"
                defaultValue={events.charge?.btC ?? ""}
              />
            </label>
            <label>
              TP tiempo
              <input
                name="turningPointTimeS"
                defaultValue={fmtSeconds(events.turningPoint?.tS)}
              />
            </label>
            <label>
              TP BT °C
              <input
                name="turningPointTempC"
                type="number"
                step="0.1"
                defaultValue={events.turningPoint?.btC ?? ""}
              />
            </label>
            <label>
              Amarilleo tiempo
              <input
                name="yellowingTimeS"
                defaultValue={fmtSeconds(events.yellowing?.tS)}
              />
            </label>
            <label>
              Amarilleo BT °C
              <input
                name="yellowingTempC"
                type="number"
                step="0.1"
                defaultValue={events.yellowing?.btC ?? ""}
              />
            </label>
            <label>
              FC tiempo
              <input
                name="firstCrackTimeS"
                defaultValue={fmtSeconds(events.firstCrack?.tS)}
              />
            </label>
            <label>
              FC BT °C
              <input
                name="firstCrackTempC"
                type="number"
                step="0.1"
                defaultValue={events.firstCrack?.btC ?? ""}
              />
            </label>
            <label>
              Drop tiempo
              <input
                name="dropTimeS"
                defaultValue={fmtSeconds(events.drop?.tS)}
              />
            </label>
            <label>
              Drop BT °C
              <input
                name="dropTempC"
                type="number"
                step="0.1"
                defaultValue={events.drop?.btC ?? ""}
              />
            </label>
          </div>
        </details>

        <label>
          Observaciones
          <textarea
            name="notes"
            rows={3}
            placeholder="Scorching, comportamiento del crack, ajustes, etc."
          />
        </label>

        <button type="submit">
          Confirmar inventario y registrar batch
        </button>
      </form>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/roasting">← Cancelar y volver a Tueste</Link>
      </p>
    </main>
  );
}
