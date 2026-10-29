/**
 * Diagnóstico exclusivo LIVE de OPS Guardian. No reclama comandas ni imprime.
 * Invocar con: node --env-file=.env.local scripts/local/print-guardian-health.mjs --mode=preflight
 * El resultado es un único JSON sin credenciales, incluso ante fallos.
 */
import postgres from "postgres";
import {bridgeTargets, pulseState, validateLiveEnvironment} from "./print-guardian-core.mjs";

const mode = process.argv.includes("--mode=pulse") ? "pulse" : "preflight";
const env = process.env;
const report = {
  mode, config: false, database: false, api: mode === "pulse" ? null : false,
  bridges: false, bridgeStatus: [], ageSeconds: null, pulse: "NEVER", dependenciesReady: false,
  reason: "STARTING",
};

function timeout(ms) { return AbortSignal.timeout(ms); }

async function checkDatabase() {
  const db = postgres(env.DATABASE_URL, {
    max: 1, prepare: false, connect_timeout: 4,
    idle_timeout: 2, max_lifetime: 5,
  });
  try {
    const rows = await db`
      select p.bridge_ready as bridge_ready,
             extract(epoch from (now() - p.last_seen)) as age_seconds
      from public.stores s
      join public.organizations o on o.id = s.organization_id
      left join public.pos_print_station_status p on p.store_id = s.id
          and p.organization_id = o.id
      where o.slug = 'cafe-epico' and s.code = 'TEPEXI'
          and s.is_active = true
      limit 1
    `;
    if (rows.length !== 1) return false;
    report.ageSeconds = rows[0].age_seconds === null
      ? null : Math.round(Number(rows[0].age_seconds));
    report.pulse = pulseState(report.ageSeconds, rows[0].bridge_ready);
    return true;
  } finally {
    await db.end({timeout: 2});
  }
}

async function checkApi() {
  // Sólo POLL: lee el feed sin CLAIM, FINISH, ACK ni HEARTBEAT.
  const response = await fetch("http://127.0.0.1:3001/api/local-print-agent", {
    method: "POST", cache: "no-store", signal: timeout(9000),
    headers: {
      Authorization: "Bearer " + env.OPS_LOCAL_PRINT_AGENT_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({op: "POLL", since: new Date().toISOString(), lastVersion: ""}),
  });
  return response.status === 200;
}

async function checkBridges() {
  let allReady = true;
  for (const {port, token} of bridgeTargets(env)) {
    let ready = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: {"X-Cafe-Epico-Token": token}, signal: timeout(4000),
      });
      const result = response.ok ? await response.json().catch(() => null) : null;
      ready = result?.ok === true && result.rasterBands === true;
    } catch { ready = false; }
    report.bridgeStatus.push({port, ready}); // Sin tokens en el JSON de salida.
    if (!ready) allReady = false;
  }
  return allReady;
}

async function main() {
  const validation = validateLiveEnvironment(env);
  report.config = validation.ok;
  if (!validation.ok) { report.reason = validation.reason; return; }
  try { report.database = await checkDatabase(); }
  catch { report.reason = "DATABASE_UNAVAILABLE"; return; }
  if (!report.database) { report.reason = "STORE_UNAVAILABLE"; return; }
  try { report.bridges = await checkBridges(); }
  catch { report.bridges = false; }
  if (mode === "preflight") {
    try { report.api = await checkApi(); }
    catch { report.api = false; }
  }
  report.dependenciesReady = report.database && report.bridges && report.api !== false;
  report.reason = !report.bridges ? "BRIDGE_UNAVAILABLE" :
    report.api === false ? "API_NOT_AUTHORIZED" :
    report.pulse === "HEALTHY" ? "PRINTING_READY" :
    "WORKER_" + report.pulse;
}

try { await main(); }
catch { report.reason = "HEALTH_CHECK_FAILED"; }
console.log(JSON.stringify(report));
