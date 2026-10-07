import { parseHiBeanJsonRoot } from "@/src/domain/roasting/hibean";

export type RoastCurvePoint = {
  tS: number;
  btC?: number;
  etC?: number;
  rorCMin?: number;
  powerPct?: number;
  fanPct?: number;
};

export type RoastCurveEvent = {
  tS: number;
  btC?: number;
};

export type RoastCurveImport = {
  points: RoastCurvePoint[];
  format:
    | "JSON_CANONICAL"
    | "JSON_ARTISAN"
    | "JSON_HIBEAN"
    | "JSON_GENERIC"
    | "CSV";
  warnings: string[];
  events?: {
    charge?: RoastCurveEvent;
    turningPoint?: RoastCurveEvent;
    yellowing?: RoastCurveEvent;
    firstCrack?: RoastCurveEvent;
    drop?: RoastCurveEvent;
  };
  metadata?: {
    title?: string;
    roaster?: string;
    provider?: "HIBEAN";
    externalRoastId?: string;
    localRoastId?: string;
    roastedAt?: string;
    durationS?: number;
    temperatureUnit?: string;
    greenWeightG?: number;
    roastedWeightG?: number;
    bean?: {
      cloudId?: string;
      localId?: string;
      name?: string;
      origin?: string;
      regionCode?: string;
      harvestYear?: number;
      altitudeRange?: string;
      density?: number;
      moistureContent?: number;
      remainingInventoryG?: number;
      inventoryEnabled?: boolean;
      lowInventoryReminderG?: number;
      varietyCode?: string;
      processingMethodCode?: string;
    };
    environment?: {
      temperatureC?: number;
      humidityPct?: number;
      pressureRaw?: number;
    };
    device?: {
      cloudId?: string;
      name?: string;
      manufacturer?: string;
      model?: string;
    };
    phaseList?: unknown[];
    aiTelemetry?: Record<string, unknown>;
  };
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function parseNumeric(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimeValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
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

  return parseNumeric(text);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstValue(
  row: Record<string, unknown>,
  names: RegExp[],
) {
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalize(key);
    if (names.some((pattern) => pattern.test(normalized))) {
      return value;
    }
  }
  return undefined;
}

function pointFromObject(
  row: Record<string, unknown>,
): RoastCurvePoint | null {
  const tS = parseTimeValue(
    firstValue(row, [
      /^ts$/,
      /^time$/,
      /^tiempo$/,
      /elapsed/,
      /^sec/,
      /^seconds$/,
      /^x$/,
    ]),
  );
  if (tS == null || tS < 0) return null;

  const btC = parseNumeric(
    firstValue(row, [
      /^btc$/,
      /^bt$/,
      /bean temp/,
      /bean temperature/,
      /temperatura grano/,
      /^temp2$/,
    ]),
  );
  const etC = parseNumeric(
    firstValue(row, [
      /^etc$/,
      /^et$/,
      /environment/,
      /exhaust/,
      /temperatura ambiente/,
      /^temp1$/,
    ]),
  );
  const rorCMin = parseNumeric(
    firstValue(row, [
      /^rorcmin$/,
      /^ror$/,
      /rate of rise/,
      /delta bt/,
      /ror bt/,
      /^delta2$/,
    ]),
  );
  const powerPct = parseNumeric(
    firstValue(row, [
      /^powerpct$/,
      /^power$/,
      /heater/,
      /^heat$/,
      /potencia/,
      /burner/,
    ]),
  );
  const fanPct = parseNumeric(
    firstValue(row, [
      /^fanpct$/,
      /^fan$/,
      /airflow/,
      /ventilador/,
    ]),
  );

  return {
    tS,
    ...(btC != null ? { btC } : {}),
    ...(etC != null ? { etC } : {}),
    ...(rorCMin != null ? { rorCMin } : {}),
    ...(powerPct != null ? { powerPct } : {}),
    ...(fanPct != null ? { fanPct } : {}),
  };
}

function deriveRor(points: RoastCurvePoint[]) {
  const result = points.map((point) => ({ ...point }));
  const withBt = result.filter(
    (point): point is RoastCurvePoint & { btC: number } =>
      point.btC != null && Number.isFinite(point.btC),
  );

  for (const point of result) {
    if (point.rorCMin != null || point.btC == null) continue;

    const previousCandidates = withBt.filter(
      (candidate) =>
        candidate.tS < point.tS &&
        point.tS - candidate.tS >= 15 &&
        point.tS - candidate.tS <= 45,
    );
    const previous = previousCandidates.at(-1);
    if (!previous) continue;

    const seconds = point.tS - previous.tS;
    if (seconds <= 0) continue;
    point.rorCMin = ((point.btC - previous.btC) / seconds) * 60;
  }

  return result;
}

function cleanPoints(points: RoastCurvePoint[]) {
  const unique = new Map<number, RoastCurvePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.tS) || point.tS < 0) continue;
    unique.set(point.tS, point);
  }

  return deriveRor(
    [...unique.values()].sort((a, b) => a.tS - b.tS),
  );
}

function parseParallelArrays(
  source: Record<string, unknown>,
): RoastCurvePoint[] {
  const keys = Object.keys(source);
  const findArray = (patterns: RegExp[]) => {
    const key = keys.find((candidate) =>
      patterns.some((pattern) => pattern.test(normalize(candidate))),
    );
    return key && Array.isArray(source[key])
      ? (source[key] as unknown[])
      : null;
  };

  const times = findArray([
    /^timex$/,
    /^time$/,
    /^tiempo$/,
    /^ts$/,
    /elapsed/,
  ]);
  if (!times) return [];

  const bt = findArray([/^temp2$/, /^bt$/, /^btc$/, /bean temp/]);
  const et = findArray([/^temp1$/, /^et$/, /^etc$/, /environment/]);
  const ror = findArray([/^delta2$/, /^ror$/, /^rorcmin$/, /delta bt/]);
  const power = findArray([/^power$/, /^powerpct$/, /heater/, /burner/]);
  const fan = findArray([/^fan$/, /^fanpct$/, /airflow/]);

  return times.flatMap((timeValue, index) => {
    const tS = parseTimeValue(timeValue);
    if (tS == null) return [];

    const btC = bt ? parseNumeric(bt[index]) : undefined;
    const etC = et ? parseNumeric(et[index]) : undefined;
    const rorCMin = ror ? parseNumeric(ror[index]) : undefined;
    const powerPct = power ? parseNumeric(power[index]) : undefined;
    const fanPct = fan ? parseNumeric(fan[index]) : undefined;

    return [{
      tS,
      ...(btC != null && btC > -50 ? { btC } : {}),
      ...(etC != null && etC > -50 ? { etC } : {}),
      ...(rorCMin != null ? { rorCMin } : {}),
      ...(powerPct != null ? { powerPct } : {}),
      ...(fanPct != null ? { fanPct } : {}),
    }];
  });
}

function eventFromIndex(
  indexValue: unknown,
  points: RoastCurvePoint[],
) {
  const index = Number(indexValue);
  if (!Number.isInteger(index) || index < 0 || index >= points.length) {
    return undefined;
  }
  const point = points[index];
  return {
    tS: point.tS,
    ...(point.btC != null ? { btC: point.btC } : {}),
  };
}

function artisanEvents(
  root: Record<string, unknown>,
  points: RoastCurvePoint[],
) {
  const timeindex = Array.isArray(root.timeindex)
    ? root.timeindex
    : null;
  if (!timeindex) return undefined;

  return {
    charge: eventFromIndex(timeindex[0], points),
    yellowing: eventFromIndex(timeindex[1], points),
    firstCrack: eventFromIndex(timeindex[2], points),
    drop: eventFromIndex(timeindex[6], points),
  };
}

function genericEvents(root: Record<string, unknown>) {
  const events = objectRecord(root.events);
  if (!events) return undefined;

  const readEvent = (patterns: RegExp[]) => {
    const raw = firstValue(events, patterns);
    const row = objectRecord(raw);
    if (!row) return undefined;
    const tS = parseTimeValue(
      firstValue(row, [/^ts$/, /^time$/, /^seconds$/, /elapsed/]),
    );
    const btC = parseNumeric(
      firstValue(row, [/^btc$/, /^bt$/, /bean temp/]),
    );
    if (tS == null) return undefined;
    return {
      tS,
      ...(btC != null ? { btC } : {}),
    };
  };

  return {
    charge: readEvent([/^charge$/, /^carga$/]),
    yellowing: readEvent([/^yellowing$/, /^dry$/, /amarilleo/]),
    firstCrack: readEvent([/^first crack$/, /^fc$/, /^fcs$/]),
    drop: readEvent([/^drop$/, /descarga/]),
  };
}

function parseJson(raw: string): RoastCurveImport | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }

  const warnings: string[] = [];

  if (Array.isArray(decoded)) {
    const points = cleanPoints(
      decoded.flatMap((value) => {
        const row = objectRecord(value);
        const point = row ? pointFromObject(row) : null;
        return point ? [point] : [];
      }),
    );
    if (points.length > 0) {
      return {
        points,
        format: "JSON_CANONICAL",
        warnings,
      };
    }
  }

  const root = objectRecord(decoded);
  if (!root) return null;

  const hibean = parseHiBeanJsonRoot(root);
  if (hibean) {
    return {
      points: cleanPoints(hibean.points),
      format: "JSON_HIBEAN",
      warnings: [],
      events: hibean.events,
      metadata: {
        title: hibean.metadata.roastName,
        roaster: hibean.metadata.device?.name,
        ...hibean.metadata,
      },
    };
  }

  for (const key of ["curveData", "points", "samples", "data"]) {
    const value = root[key];
    if (!Array.isArray(value)) continue;
    const points = cleanPoints(
      value.flatMap((entry) => {
        const row = objectRecord(entry);
        const point = row ? pointFromObject(row) : null;
        return point ? [point] : [];
      }),
    );
    if (points.length > 0) {
      return {
        points,
        format: "JSON_GENERIC",
        warnings,
      };
    }
  }

  const artisanPoints = cleanPoints(parseParallelArrays(root));
  if (artisanPoints.length > 0) {
    if (!artisanPoints.some((point) => point.rorCMin != null)) {
      warnings.push(
        "El archivo no incluía RoR utilizable; Ops lo estimó desde BT.",
      );
    }
    const isArtisan =
      Array.isArray(root.timex) || Array.isArray(root.temp2);
    return {
      points: artisanPoints,
      format: isArtisan ? "JSON_ARTISAN" : "JSON_GENERIC",
      warnings,
      events: isArtisan
        ? artisanEvents(root, artisanPoints)
        : genericEvents(root),
      metadata: {
        title:
          typeof root.title === "string" ? root.title : undefined,
        roaster:
          typeof root.roastertype === "string"
            ? root.roastertype
            : undefined,
      },
    };
  }

  return null;
}

function indexOfHeader(headers: string[], tests: RegExp[]) {
  return headers.findIndex((header) =>
    tests.some((test) => test.test(header)),
  );
}

export function parseRoastCurveCsv(raw: string): RoastCurvePoint[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const first = lines[0];
  const delimiter = first.includes("\t")
    ? "\t"
    : (first.match(/;/g)?.length ?? 0) >
        (first.match(/,/g)?.length ?? 0)
      ? ";"
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
    const tS = parseTimeValue(cells[timeIndex] ?? "");
    if (tS == null) continue;

    const read = (index: number) => {
      if (index < 0) return undefined;
      const rawValue = cells[index] ?? "";
      return parseNumeric(
        semicolonDelimited ? rawValue.replace(",", ".") : rawValue,
      );
    };

    const point: RoastCurvePoint = { tS };
    const bt = read(btIndex);
    const et = read(etIndex);
    const ror = read(rorIndex);
    const power = read(powerIndex);
    const fan = read(fanIndex);

    if (bt != null) point.btC = bt;
    if (et != null) point.etC = et;
    if (ror != null) point.rorCMin = ror;
    if (power != null) point.powerPct = power;
    if (fan != null) point.fanPct = fan;
    points.push(point);
  }

  return cleanPoints(points);
}

export function parseRoastCurveInput(raw: string): RoastCurveImport {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { points: [], format: "CSV", warnings: [] };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = parseJson(trimmed);
    if (json) return json;
  }

  const points = parseRoastCurveCsv(trimmed);
  return {
    points,
    format: "CSV",
    warnings:
      points.length > 0
        ? []
        : ["No se detectaron puntos válidos en el archivo o texto."],
  };
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
