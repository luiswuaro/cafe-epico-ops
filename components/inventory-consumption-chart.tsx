type Point = {
  date: string;
  consumption: number;
  waste: number;
};

export function InventoryConsumptionChart({
  points,
  unit,
}: {
  points: Point[];
  unit: string;
}) {
  const max = Math.max(...points.map((point) => point.consumption), 0);

  if (max <= 0) {
    return (
      <p className="muted">
        Aún no hay movimientos de consumo en este periodo.
      </p>
    );
  }

  const width = 720;
  const height = 220;
  const top = 18;
  const bottom = 36;
  const left = 34;
  const usableHeight = height - top - bottom;
  const usableWidth = width - left - 10;
  const step = usableWidth / points.length;
  const barWidth = Math.max(2, step * 0.62);
  const baseY = top + usableHeight;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Consumo diario de inventario durante los últimos 30 días"
        style={{ width: "100%", minWidth: "620px", height: "auto" }}
      >
        <line
          x1={left}
          x2={width - 10}
          y1={baseY}
          y2={baseY}
          stroke="currentColor"
          opacity="0.25"
        />
        {points.map((point, index) => {
          const totalHeight =
            point.consumption > 0
              ? (point.consumption / max) * usableHeight
              : 0;
          const wasteHeight =
            point.waste > 0 ? (point.waste / max) * usableHeight : 0;
          const x = left + index * step + (step - barWidth) / 2;
          const showLabel =
            index === 0 ||
            index === points.length - 1 ||
            index % 5 === 0;

          return (
            <g key={point.date}>
              <title>
                {point.date}: {point.consumption.toFixed(3)} {unit}
                {point.waste > 0
                  ? ` · merma ${point.waste.toFixed(3)} ${unit}`
                  : ""}
              </title>
              <rect
                x={x}
                y={baseY - totalHeight}
                width={barWidth}
                height={totalHeight}
                fill="currentColor"
                opacity="0.75"
                rx="2"
              />
              {wasteHeight > 0 && (
                <rect
                  x={x}
                  y={baseY - wasteHeight}
                  width={barWidth}
                  height={wasteHeight}
                  fill="currentColor"
                  opacity="0.3"
                  rx="2"
                />
              )}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={baseY + 18}
                  textAnchor="middle"
                  fontSize="10"
                  fill="currentColor"
                  opacity="0.65"
                >
                  {point.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <text
          x="4"
          y={top + 8}
          fontSize="10"
          fill="currentColor"
          opacity="0.65"
        >
          {max.toFixed(1)} {unit}
        </text>
      </svg>
      <p className="muted">
        Barra = consumo registrado. La parte tenue dentro de la barra corresponde a merma.
      </p>
    </div>
  );
}
