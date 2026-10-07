import Link from "next/link";
import { getRoastingDashboard } from "@/src/application/roasting/dashboard";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function seconds(value: number | null) {
  if (value == null) return "—";
  const min = Math.floor(value / 60);
  const sec = Math.round(value % 60);
  return min + ":" + String(sec).padStart(2, "0");
}

function linePoints(
  curve: Array<{ tS: number; btC?: number }>,
  maxTime: number,
  minTemp: number,
  maxTemp: number,
) {
  const width = 760;
  const height = 280;
  return curve
    .filter((point) => point.btC != null)
    .map((point) => {
      const x = 40 + (point.tS / Math.max(1, maxTime)) * (width - 60);
      const y =
        20 +
        (1 -
          ((point.btC ?? minTemp) - minTemp) /
            Math.max(1, maxTemp - minTemp)) *
          (height - 50);
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
}

export default async function RoastComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { organizationId } = await requirePermission("roast.manage");
  const data = await getRoastingDashboard(organizationId);

  const requested = params.batch;
  const ids =
    typeof requested === "string"
      ? [requested]
      : Array.isArray(requested)
        ? requested
        : [];
  const selectedIds = ids.slice(0, 5);
  const selected = selectedIds.length
    ? data.batches.filter((batch) => selectedIds.includes(batch.id))
    : data.batches.slice(0, 3);

  const curveBatches = selected.filter(
    (batch) => Array.isArray(batch.curveData) && batch.curveData.length > 1,
  );
  const allPoints = curveBatches.flatMap(
    (batch) =>
      batch.curveData as Array<{ tS: number; btC?: number }>,
  );
  const maxTime = Math.max(1, ...allPoints.map((point) => point.tS));
  const temperatures = allPoints
    .map((point) => point.btC)
    .filter((value): value is number => value != null);
  const minTemp =
    temperatures.length > 0 ? Math.min(...temperatures) : 80;
  const maxTemp =
    temperatures.length > 0 ? Math.max(...temperatures) : 220;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ROAST ENGINEER · COMPARADOR</p>
        <h1>Comparar batches</h1>
        <p className="muted">
          Contrasta curva, FC, drop, DTR, merma, costo, cata y desempeño de
          espresso. Máximo 5 batches a la vez.
        </p>
      </section>

      <form className="card stack" method="get">
        <h2>Selecciona batches</h2>
        <div className="grid">
          {data.batches.slice(0, 18).map((batch) => (
            <label key={batch.id}>
              <input
                type="checkbox"
                name="batch"
                value={batch.id}
                defaultChecked={selected.some((row) => row.id === batch.id)}
              />{" "}
              {batch.batchCode} · {batch.lot?.name ?? "Lote"}
            </label>
          ))}
        </div>
        <button type="submit">Comparar selección</button>
      </form>

      {curveBatches.length > 0 && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>BT superpuesta</h2>
          <p className="muted">
            Misma escala temporal y térmica para detectar desplazamientos de
            energía. La opacidad identifica el orden de la leyenda.
          </p>
          <div style={{ overflowX: "auto" }}>
            <svg
              viewBox="0 0 760 280"
              role="img"
              aria-label="Comparación de curvas BT"
              style={{ width: "100%", minWidth: "650px" }}
            >
              <line x1="40" y1="230" x2="740" y2="230" stroke="currentColor" opacity="0.25" />
              <line x1="40" y1="20" x2="40" y2="230" stroke="currentColor" opacity="0.25" />
              {curveBatches.map((batch, index) => (
                <polyline
                  key={batch.id}
                  points={linePoints(
                    batch.curveData as Array<{ tS: number; btC?: number }>,
                    maxTime,
                    minTemp,
                    maxTemp,
                  )}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2 + index * 0.25}
                  opacity={Math.max(0.4, 1 - index * 0.12)}
                />
              ))}
              <text x="45" y="15" fontSize="11" fill="currentColor">
                {maxTemp.toFixed(0)} °C
              </text>
              <text x="45" y="250" fontSize="11" fill="currentColor">
                {minTemp.toFixed(0)} °C
              </text>
              <text x="680" y="250" fontSize="11" fill="currentColor">
                {seconds(maxTime)}
              </text>
            </svg>
          </div>
          <div className="stack">
            {curveBatches.map((batch, index) => (
              <div className="task" key={batch.id}>
                <strong>{index + 1}. {batch.batchCode}</strong>
                <span>{batch.lot?.name ?? "Lote"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Comparación técnica</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Variable</th>
                {selected.map((batch) => (
                  <th key={batch.id}>{batch.batchCode}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Café", (b: (typeof selected)[number]) => b.lot?.name ?? "—"],
                ["Edad", (b: (typeof selected)[number]) => b.ageDays.toFixed(1) + " d"],
                ["Carga", (b: (typeof selected)[number]) => b.chargeTempC ? Number(b.chargeTempC).toFixed(1) + " °C" : "—"],
                ["FC", (b: (typeof selected)[number]) => seconds(b.firstCrackTimeS)],
                ["FC BT", (b: (typeof selected)[number]) => b.firstCrackTempC ? Number(b.firstCrackTempC).toFixed(1) + " °C" : "—"],
                ["Drop", (b: (typeof selected)[number]) => seconds(b.dropTimeS)],
                ["Drop BT", (b: (typeof selected)[number]) => b.dropTempC ? Number(b.dropTempC).toFixed(1) + " °C" : "—"],
                ["DTR", (b: (typeof selected)[number]) => b.dtrPct ? Number(b.dtrPct).toFixed(2) + "%" : "—"],
                ["Merma", (b: (typeof selected)[number]) => Number(b.weightLossPct).toFixed(2) + "%"],
                ["RoR en FC", (b: (typeof selected)[number]) => b.diagnostics.rorAtFirstCrack == null ? "—" : b.diagnostics.rorAtFirstCrack.toFixed(1)],
                ["Crash", (b: (typeof selected)[number]) => b.diagnostics.crashMagnitude == null ? "—" : b.diagnostics.crashMagnitude.toFixed(1)],
                ["Flick", (b: (typeof selected)[number]) => b.diagnostics.flickMagnitude == null ? "—" : b.diagnostics.flickMagnitude.toFixed(1)],
                ["Cata", (b: (typeof selected)[number]) => b.latestSensory?.overallScore ? Number(b.latestSensory.overallScore).toFixed(2) : "—"],
                ["Descriptores", (b: (typeof selected)[number]) => b.latestSensory?.descriptors ?? "—"],
                ["QC espresso", (b: (typeof selected)[number]) => b.espressoQcPassRate == null ? "—" : b.espressoQcPassRate.toFixed(0) + "%"],
                ["Costo/kg", (b: (typeof selected)[number]) => b.roastedCostPerKg == null ? "—" : money.format(b.roastedCostPerKg)],
              ].map(([label, read]) => (
                <tr key={String(label)}>
                  <td><strong>{String(label)}</strong></td>
                  {selected.map((batch) => (
                    <td key={batch.id} style={{ textAlign: "right" }}>
                      {(read as (b: (typeof selected)[number]) => string)(batch)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link href="/admin/roasting">← Volver a Tueste</Link>
      </p>
    </main>
  );
}
