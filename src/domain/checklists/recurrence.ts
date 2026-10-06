type Recurrence = { rrule: string; startDate: Date; timezone: string };
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: get("weekday").slice(0,2).toUpperCase() };
}
function ordinalDay(parts: { y:number; m:number; d:number }) { return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d) / 86400000); }
export function isRecurrenceDue(rule: Recurrence, at: Date) {
  const tokens = Object.fromEntries(rule.rrule.split(";").map((x) => x.split("=", 2))) as Record<string,string>;
  const freq = tokens.FREQ;
  const interval = Math.max(1, Number(tokens.INTERVAL ?? "1"));
  const start = dateParts(rule.startDate, rule.timezone);
  const now = dateParts(at, rule.timezone);
  const dayDelta = ordinalDay(now) - ordinalDay(start);
  if (dayDelta < 0) return false;
  if (freq === "DAILY") return dayDelta % interval === 0;
  if (freq === "WEEKLY") {
    const allowed = (tokens.BYDAY ?? DAY_CODES[new Date(Date.UTC(start.y,start.m-1,start.d)).getUTCDay()]).split(",");
    return allowed.includes(now.weekday) && Math.floor(dayDelta / 7) % interval === 0;
  }
  return false;
}
