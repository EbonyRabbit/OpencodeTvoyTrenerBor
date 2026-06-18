"use client";

type DataPoint = { label: string; value: number | null };

function formatChartDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return raw;
  }
}

export function MiniLineChart({
  data,
  color = "var(--color-primary)",
  height = 120,
  label = "График динамики",
}: {
  data: DataPoint[];
  color?: string;
  height?: number;
  label?: string;
}) {
  const validPoints: { label: string; value: number; index: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    if (point.value !== null) {
      validPoints.push({ label: point.label, value: point.value, index: i });
    }
  }

  if (validPoints.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        Недостаточно данных для графика
      </p>
    );
  }

  const values = validPoints.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = range * 0.1;
  const adjustedMin = min - padding;
  const adjustedMax = max + padding;
  const adjustedRange = adjustedMax - adjustedMin || 1;

  const width = 240;
  const chartWidth = width - 40;
  const chartHeight = height - 20;
  const stepX = chartWidth / Math.max(validPoints.length - 1, 1);

  const linePoints = validPoints
    .map((p, i) => {
      const x = 35 + i * stepX;
      const y = 10 + chartHeight - ((p.value - adjustedMin) / adjustedRange) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const visibleIndices = getVisibleIndices(validPoints.length);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={label}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={linePoints}
      />
      {validPoints.map((p, i) => {
        const x = 35 + i * stepX;
        const y = 10 + chartHeight - ((p.value - adjustedMin) / adjustedRange) * chartHeight;
        const showLabel = visibleIndices.has(i);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="3" fill={color} />
            {showLabel && (
              <text
                x={x}
                y={y - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {p.value}
              </text>
            )}
            {showLabel && (
              <text
                x={x}
                y={height - 2}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="9"
              >
                {formatChartDate(p.label)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function getVisibleIndices(count: number): Set<number> {
  if (count <= 8) {
    return new Set(Array.from({ length: count }, (_, i) => i));
  }
  const step = Math.floor(count / 6);
  const indices = new Set<number>();
  for (let i = 0; i < count; i += step) {
    indices.add(i);
  }
  indices.add(count - 1);
  return indices;
}
