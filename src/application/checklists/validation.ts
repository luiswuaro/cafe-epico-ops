export type NumericSpec = { min?: number | null; max?: number | null };
export function validateNumeric(value: number, spec: NumericSpec) {
  if (spec.min != null && value < spec.min) return { ok: false, reason: `BELOW_MIN:${spec.min}` };
  if (spec.max != null && value > spec.max) return { ok: false, reason: `ABOVE_MAX:${spec.max}` };
  return { ok: true, reason: null };
}
