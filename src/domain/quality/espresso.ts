export type ExtractionQualitySpec = {
  time_min_s: number;
  time_max_s: number;
  ratio_min?: number;
  ratio_max?: number;
  target_ratio?: number;
  yield_tolerance_g?: number;
};

export type ExtractionEvaluation = {
  ratio: number;
  withinTimeSpec: boolean;
  withinYieldSpec: boolean;
  withinSpec: boolean;
  timeMinS: number;
  timeMaxS: number;
  yieldMinG: number;
  yieldMaxG: number;
  targetYieldG: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseExtractionQualitySpec(
  raw: Record<string, unknown>,
): ExtractionQualitySpec {
  const timeMin = finiteNumber(raw.time_min_s);
  const timeMax = finiteNumber(raw.time_max_s);
  const ratioMin = finiteNumber(raw.ratio_min);
  const ratioMax = finiteNumber(raw.ratio_max);
  const targetRatio = finiteNumber(raw.target_ratio);
  const tolerance = finiteNumber(raw.yield_tolerance_g);

  if (timeMin == null || timeMax == null || timeMin > timeMax) {
    throw new Error("Invalid extraction time specification");
  }

  const hasRatioRange =
    ratioMin != null &&
    ratioMax != null &&
    ratioMin > 0 &&
    ratioMax >= ratioMin;

  const hasTarget =
    targetRatio != null &&
    targetRatio > 0 &&
    tolerance != null &&
    tolerance >= 0;

  if (!hasRatioRange && !hasTarget) {
    throw new Error("Invalid extraction yield specification");
  }

  return {
    time_min_s: timeMin,
    time_max_s: timeMax,
    ...(hasRatioRange
      ? { ratio_min: ratioMin!, ratio_max: ratioMax! }
      : {}),
    ...(hasTarget
      ? {
          target_ratio: targetRatio!,
          yield_tolerance_g: tolerance!,
        }
      : {}),
  };
}

function sameNumber(a: number | undefined, b: number) {
  return a != null && Math.abs(a - b) < 0.000001;
}

export function assertCafeEpicoExtractionSpec(
  recipeName: string,
  spec: ExtractionQualitySpec,
) {
  const valid =
    recipeName === "Ristretto base 1:1"
      ? sameNumber(spec.ratio_min, 1) &&
        sameNumber(spec.ratio_max, 1.5) &&
        spec.time_min_s === 15 &&
        spec.time_max_s === 25
      : recipeName === "Espresso base 1:2"
        ? sameNumber(spec.target_ratio, 2) &&
          sameNumber(spec.yield_tolerance_g, 2) &&
          spec.time_min_s === 22 &&
          spec.time_max_s === 35
        : recipeName === "Lungo base 1:2.5"
          ? sameNumber(spec.target_ratio, 2.5) &&
            sameNumber(spec.yield_tolerance_g, 2) &&
            spec.time_min_s === 30 &&
            spec.time_max_s === 40
          : true;

  if (!valid) {
    throw new Error(
      `La especificación activa de ${recipeName} no coincide con el estándar operativo de Café Épico`,
    );
  }
}

export function evaluateExtraction(
  doseG: number,
  yieldG: number,
  brewTimeS: number,
  spec: ExtractionQualitySpec,
): ExtractionEvaluation {
  if (doseG <= 0 || yieldG <= 0 || brewTimeS <= 0) {
    throw new Error("Extraction measurements must be positive");
  }

  const ratio = yieldG / doseG;
  const withinTimeSpec =
    brewTimeS >= spec.time_min_s && brewTimeS <= spec.time_max_s;

  let yieldMinG: number;
  let yieldMaxG: number;
  let targetYieldG: number | null = null;

  if (
    spec.ratio_min != null &&
    spec.ratio_max != null
  ) {
    yieldMinG = doseG * spec.ratio_min;
    yieldMaxG = doseG * spec.ratio_max;
  } else if (
    spec.target_ratio != null &&
    spec.yield_tolerance_g != null
  ) {
    targetYieldG = doseG * spec.target_ratio;
    yieldMinG = targetYieldG - spec.yield_tolerance_g;
    yieldMaxG = targetYieldG + spec.yield_tolerance_g;
  } else {
    throw new Error("Extraction yield specification is incomplete");
  }

  const withinYieldSpec =
    yieldG >= yieldMinG && yieldG <= yieldMaxG;

  return {
    ratio,
    withinTimeSpec,
    withinYieldSpec,
    withinSpec: withinTimeSpec && withinYieldSpec,
    timeMinS: spec.time_min_s,
    timeMaxS: spec.time_max_s,
    yieldMinG,
    yieldMaxG,
    targetYieldG,
  };
}
