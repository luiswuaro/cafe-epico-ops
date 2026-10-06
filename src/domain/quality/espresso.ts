export const ESPRESSO_TIME_MIN_S = 22;
export const ESPRESSO_TIME_MAX_S = 35;
export function evaluateEspressoTime(seconds: number) {
  return { withinSpec: seconds >= ESPRESSO_TIME_MIN_S && seconds <= ESPRESSO_TIME_MAX_S, min: ESPRESSO_TIME_MIN_S, max: ESPRESSO_TIME_MAX_S };
}
