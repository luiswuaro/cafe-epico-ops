type StockPoint = {
  at: Date;
  stock: number;
};

export function InventoryStockHistoryChart({
  points,
  unit,
}: {
  points: StockPoint[];
  unit: string;
}) {
  if (points.length === 0) {
    return <p className="muted">Todavía no hay capturas de existencia.</p>;
  }

  const width = 760;
  const height = 230;
  const left = 52;
  const right = 14;
  const top = 18;
  const bottom = 38;
  const usableWidth = width - left - right;
  const usableHeight = height - top - bottom;
  const values = points.map((point) => point.stock);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const x = (index: number) =>
    left +
    (points.length === 1
      ? usableWidth / 2
      : (index / (points.length - 1)) * usableWidth);
  const y = (value: number) =>
    top + ((max - value) / span) * usableHeight;
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(
          point.stock,
        ).toFixed(2)}`,
    )
    .join(" ");

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Histórico de existencia sincronizada"
        style={{ width: "100%", minWidth: "620px", height: "auto" }}
      >
        <line
          x1={left}
          x2={width - right}
          y1={top + usableHeight}
          y2={top + usableHeight}
          stroke="currentColor"
          opacity="0.2"
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {points.map((point, index) => (
          <g key={point.at.toISOString() + index}>
            <circle
              cx={x(index)}
              cy={y(point.stock)}
              r="3"
              fill="currentColor"
            />
            <title>
              {point.at.toLocaleString("es-MX", {
                timeZone: "America/Mexico_City",
                dateStyle: "short",
                timeStyle: "short",
              })}
              {": "}
              {point.stock.toFixed(3)} {unit}
            </title>
          </g>
        ))}
        <text x="4" y={top + 8} fontSize="10" fill="currentColor">
          {max.toFixed(2)} {unit}
        </text>
        <text
          x="4"
          y={top + usableHeight}
          fontSize="10"
          fill="currentColor"
        >
          {min.toFixed(2)} {unit}
        </text>
        <text
          x={left}
          y={height - 12}
          fontSize="10"
          fill="currentColor"
          opacity="0.65"
        >
          {points[0].at.toLocaleDateString("es-MX", {
            timeZone: "America/Mexico_City",
          })}
        </text>
        <text
          x={width - right}
          y={height - 12}
          textAnchor="end"
          fontSize="10"
          fill="currentColor"
          opacity="0.65"
        >
          {points.at(-1)!.at.toLocaleDateString("es-MX", {
            timeZone: "America/Mexico_City",
          })}
        </text>
      </svg>
      <p className="muted">
        Línea = capturas del stock fuente sincronizado desde Loyverse.
      </p>
    </div>
  );
}
