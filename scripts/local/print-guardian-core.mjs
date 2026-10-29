/** Reglas puras de OPS Guardian. Sin redes, SQL ni impresión. */
export const LIVE_PRINT_AGENT_NAME = "CafeEpicoOps-LIVE-PrintAgent";
export const LIVE_GUARDIAN_NAME = "CafeEpicoOps-LIVE-Guardian";
// Igual que getPrintStationHealth() del POS, para no mostrar estados contradictorios.
export const PULSE_STALE_SECONDS = 60;

export function validateLiveEnvironment(env) {
  if (env.OPS_LOCAL_FIRST !== "true" || env.OPS_QA_MODE !== "false" ||
      env.POS_LIVE_ENABLED !== "true" ||
      env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED !== "true" ||
      env.DEFAULT_ORGANIZATION_SLUG !== "cafe-epico" ||
      env.DEFAULT_STORE_CODE !== "TEPEXI" || env.VERCEL || env.VERCEL_ENV) {
    return {ok: false, reason: "CONFIG_NOT_LIVE"};
  }
  let url;
  try { url = new URL(env.DATABASE_URL); }
  catch { return {ok: false, reason: "DB_URL_INVALID"}; }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["15432", "16544"].includes(url.port) || url.pathname !== "/postgres") {
    return {ok: false, reason: "DB_NOT_LOCAL_LIVE"};
  }
  if (typeof env.OPS_LOCAL_PRINT_AGENT_TOKEN !== "string" ||
      env.OPS_LOCAL_PRINT_AGENT_TOKEN.length < 32 ||
      env.OPS_LOCAL_PRINT_AGENT_TOKEN.includes("REEMPLAZAR") ||
      !/^[0-9a-f-]{36}$/i.test(env.OPS_LOCAL_PRINT_AGENT_USER_ID ?? "")) {
    return {ok: false, reason: "AGENT_AUTH_INVALID"};
  }
  if (env.OPS_LOCAL_PRINT_RASTER_ENABLED !== "true") {
    return {ok: false, reason: "RASTER_DISABLED"};
  }
  if (!env.OPS_LOCAL_TICKET_PRINTER_TOKEN ||
      env.OPS_LOCAL_TICKET_PRINTER_TOKEN.includes("REEMPLAZAR")) {
    return {ok: false, reason: "BRIDGE_TOKEN_MISSING"};
  }
  return {ok: true, reason: "LIVE"};
}

export function bridgeTargets(env) {
  const ticketToken = env.OPS_LOCAL_TICKET_PRINTER_TOKEN;
  const kitchenToken = env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN &&
    !env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN.includes("REEMPLAZAR")
    ? env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN : ticketToken;
  const ticketPort = Number(env.OPS_LOCAL_TICKET_PRINTER_PORT || 9137);
  const kitchenPort = env.OPS_LOCAL_KITCHEN_PRINTER_PORT
    ? Number(env.OPS_LOCAL_KITCHEN_PRINTER_PORT)
    : kitchenToken === ticketToken ? ticketPort : 9138;
  if (![ticketPort, kitchenPort].every(n => Number.isInteger(n) && n >= 1024 && n <= 65535)) {
    throw Error("BRIDGE_PORT_INVALID");
  }
  const targets = [{port: ticketPort, token: ticketToken},
    {port: kitchenPort, token: kitchenToken}];
  return targets.filter((target, index) => targets.findIndex(other =>
    other.port === target.port && other.token === target.token) === index);
}

export function pulseState(ageSeconds, bridgeReady, staleAfter = PULSE_STALE_SECONDS) {
  if (ageSeconds === null || ageSeconds === undefined) return "NEVER";
  if (!Number.isFinite(ageSeconds) || ageSeconds < -10) return "INVALID_CLOCK";
  if (ageSeconds > staleAfter) return "STALE";
  return bridgeReady === true ? "HEALTHY" : "BRIDGE_UNAVAILABLE";
}

export function shouldLaunchWorker({agentCount, dependenciesReady, elapsedSinceLastStartSec}) {
  return agentCount === 0 && dependenciesReady === true &&
    Number.isFinite(elapsedSinceLastStartSec) && elapsedSinceLastStartSec >= 90;
}
