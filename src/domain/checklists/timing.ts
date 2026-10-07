export function elapsedSeconds(
  startedAt: Date | null,
  completedAt: Date | null,
) {
  if (!startedAt || !completedAt) return null;
  return Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

export function formatDurationSeconds(seconds: number | null) {
  if (seconds == null) return "sin medir";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder > 0
      ? `${minutes} min ${remainder} s`
      : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} h ${mins} min`;
}

export function timingMetrics(
  targetSeconds: number | null,
  startedAt: Date | null,
  completedAt: Date | null,
) {
  const actualSeconds = elapsedSeconds(startedAt, completedAt);

  if (targetSeconds == null || targetSeconds <= 0 || actualSeconds == null) {
    return {
      targetSeconds,
      actualSeconds,
      varianceSeconds: null,
      variancePercent: null,
      onTarget: null,
    };
  }

  const varianceSeconds = actualSeconds - targetSeconds;
  const variancePercent = (varianceSeconds / targetSeconds) * 100;

  return {
    targetSeconds,
    actualSeconds,
    varianceSeconds,
    variancePercent,
    onTarget: actualSeconds <= targetSeconds,
  };
}
