export type RoastCurvePoint = {
  tS: number;
  btC?: number;
  etC?: number;
  rorCMin?: number;
  powerPct?: number;
  fanPct?: number;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function parseNumber(value: string, semicolonDelimited: boolean) {
  const normalized = semicolonDelimited
    ? value.trim().replace(",", ".")
    : value.trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function parseTime(value: string, semicolonDelimited: boolean) {
  const text = value.trim();
  if (!text) return undefined;
  if (text.includes(":")) {
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  return parseNumber(text, semicolonDelimited);
}

function indexOfHeader(headers: string[], tests: RegExp[]) {
  return headers.findIndex((header) => tests.some((test) => test.test(header)));
}

export function parseRoastCurveCsv(raw: string): RoastCurvePoint[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const first = lines[0];
  const delimiter =
    (first.match(/;/g)?.length ?? 0) >=
    (first.match(/,/g)?.length ?? 0)
      ? ";"
      : first.includes("\t")
        ? "\t"
        : ",";
  const semicolonDelimited = delimiter === ";";

  const split = (line: string) =>
    delimiter === "\t" ? line.split("\t") : line.split(delimiter);

  const headers = split(first).map(normalize);
  const timeIndex = indexOfHeader(headers, [
    /^time$/,
    /^tiempo$/,
    /elapsed/,
    /^sec/,
    /^seconds$/,
  ]);
  const btIndex = indexOfHeader(headers, [
    /^bt$/,
    /bean temp/,
    /bean temperature/,
    /temperatura grano/,
  ]);
  const etIndex = indexOfHeader(headers, [
    /^et$/,
    /environment/,
    /exhaust/,
    /temperatura ambiente/,
  ]);
  const rorIndex = indexOfHeader(headers, [
    /^ror$/,
    /rate of rise/,
    /delta bt/,
    /ror bt/,
  ]);
  const powerIndex = indexOfHeader(headers, [
    /^power$/,
    /heater/,
    /^heat$/,
    /potencia/,
  ]);
  const fanIndex = indexOfHeader(headers, [
    /^fan$/,
    /airflow/,
    /ventilador/,
  ]);

  if (timeIndex < 0) return [];

  const points: RoastCurvePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const tS = parseTime(cells[timeIndex] ?? "", semicolonDelimited);
    if (tS == null) continue;

    const point: RoastCurvePoint = { tS };
    const bt = btIndex >= 0
      ? parseNumber(cells[btIndex] ?? "", semicolonDelimited)
      : undefined;
    const et = etIndex >= 0
      ? parseNumber(cells[etIndex] ?? "", semicolonDelimited)
      : undefined;
    const ror = rorIndex >= 0
      ? parseNumber(cells[rorIndex] ?? "", semicolonDelimited)
      : undefined;
    const power = powerIndex >= 0
      ? parseNumber(cells[powerIndex] ?? "", semicolonDelimited)
      : undefined;
    const fan = fanIndex >= 0
      ? parseNumber(cells[fanIndex] ?? "", semicolonDelimited)
      : undefined;

    if (bt != null) point.btC = bt;
    if (et != null) point.etC = et;
    if (ror != null) point.rorCMin = ror;
    if (power != null) point.powerPct = power;
    if (fan != null) point.fanPct = fan;
    points.push(point);
  }

  return points
    .filter((point) => point.tS >= 0)
    .sort((a, b) => a.tS - b.tS);
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

export function analyzeRoastCurve(
  points: RoastCurvePoint[],
  firstCrackTimeS?: number | null,
  yellowingTimeS?: number | null,
) {
  const rorPoints = points.filter(
    (point): point is RoastCurvePoint & { rorCMin: number } =>
      point.rorCMin != null && Number.isFinite(point.rorCMin),
  );

  const peakRor =
    rorPoints.length > 0
      ? Math.max(...rorPoints.map((point) => point.rorCMin))
      : null;

  if (firstCrackTimeS == null || rorPoints.length === 0) {
    return {
      peakRor,
      rorAtFirstCrack: null,
      crashMagnitude: null,
      flickMagnitude: null,
      stallSeconds: null,
      crashFlag: false,
      flickFlag: false,
      stallFlag: false,
    };
  }

  const nearest = [...rorPoints].sort(
    (a, b) =>
      Math.abs(a.tS - firstCrackTimeS) -
      Math.abs(b.tS - firstCrackTimeS),
  )[0];

  const before = rorPoints
    .filter(
      (point) =>
        point.tS >= firstCrackTimeS - 45 &&
        point.tS <= firstCrackTimeS - 10,
    )
    .map((point) => point.rorCMin);
  const afterEarly = rorPoints
    .filter(
      (point) =>
        point.tS >= firstCrackTimeS &&
        point.tS <= firstCrackTimeS + 45,
    )
    .map((point) => point.rorCMin);
  const afterLate = rorPoints
    .filter(
      (point) =>
        point.tS >= firstCrackTimeS + 20 &&
        point.tS <= firstCrackTimeS + 90,
    )
    .map((point) => point.rorCMin);

  const preMean = mean(before);
  const postMin = afterEarly.length ? Math.min(...afterEarly) : null;
  const postMax = afterLate.length ? Math.max(...afterLate) : null;

  const crashMagnitude =
    preMean != null && postMin != null ? preMean - postMin : null;
  const flickMagnitude =
    postMin != null && postMax != null ? postMax - postMin : null;

  const stallStart = yellowingTimeS ?? firstCrackTimeS;
  const nonPositive = rorPoints.filter(
    (point) =>
      point.tS >= stallStart && point.rorCMin <= 0,
  );
  let stallSeconds = 0;
  for (let i = 1; i < nonPositive.length; i++) {
    const delta = nonPositive[i].tS - nonPositive[i - 1].tS;
    if (delta <= 15) stallSeconds += Math.max(0, delta);
  }

  return {
    peakRor,
    rorAtFirstCrack: nearest?.rorCMin ?? null,
    crashMagnitude,
    flickMagnitude,
    stallSeconds,
    crashFlag: crashMagnitude != null && crashMagnitude >= 3,
    flickFlag: flickMagnitude != null && flickMagnitude >= 2,
    stallFlag: stallSeconds >= 10,
  };
}

export function estimateRoastEnergyKwh(
  points: RoastCurvePoint[],
  totalTimeS: number | null,
  nominalPowerW: number,
) {
  if (nominalPowerW <= 0 || !totalTimeS || totalTimeS <= 0) return null;

  const powerPoints = points.filter(
    (point): point is RoastCurvePoint & { powerPct: number } =>
      point.powerPct != null &&
      Number.isFinite(point.powerPct) &&
      point.tS >= 0 &&
      point.tS <= totalTimeS,
  );

  if (powerPoints.length < 2) {
    return (nominalPowerW / 1000) * (totalTimeS / 3600);
  }

  let wattSeconds = 0;
  for (let i = 1; i < powerPoints.length; i++) {
    const prev = powerPoints[i - 1];
    const current = powerPoints[i];
    const duration = Math.max(0, current.tS - prev.tS);
    const averagePct = (prev.powerPct + current.powerPct) / 2;
    wattSeconds += nominalPowerW * (averagePct / 100) * duration;
  }

  return wattSeconds / 3_600_000;
}
