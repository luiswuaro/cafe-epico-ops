import assert from "node:assert/strict";
import test from "node:test";
import {bridgeTargets, pulseState, shouldLaunchWorker, validateLiveEnvironment} from "./print-guardian-core.mjs";

const live = {
  OPS_LOCAL_FIRST: "true", OPS_QA_MODE: "false", POS_LIVE_ENABLED: "true",
  NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED: "true",
  DEFAULT_ORGANIZATION_SLUG: "cafe-epico", DEFAULT_STORE_CODE: "TEPEXI",
  DATABASE_URL: "postgres://postgres:fake@127.0.0.1:15432/postgres",
  OPS_LOCAL_PRINT_AGENT_TOKEN: "a".repeat(40),
  OPS_LOCAL_PRINT_AGENT_USER_ID: "12345678-1234-4123-8123-123456789abc",
  OPS_LOCAL_PRINT_RASTER_ENABLED: "true", OPS_LOCAL_TICKET_PRINTER_TOKEN: "ticket-token",
};

test("sólo usa ambiente de LIVE local, rechaza QA y nube", () => {
  assert.equal(validateLiveEnvironment(live).ok, true);
  for (const change of [
    {OPS_QA_MODE: "true"}, {DEFAULT_STORE_CODE: "QA-TEPEXI"},
    {DATABASE_URL: "postgres://postgres:pass@cloud.test:5432/postgres"},
    {DATABASE_URL: "postgres://postgres:pass@127.0.0.1:15432/qa"},
    {VERCEL_ENV: "production"}, {OPS_LOCAL_PRINT_AGENT_TOKEN: "corto"},
  ]) assert.equal(validateLiveEnvironment({...live, ...change}).ok, false);
});

test("puentes compartidos no se consultan dos veces", () => {
  assert.equal(bridgeTargets(live).length, 1);
  assert.equal(bridgeTargets({...live, OPS_LOCAL_KITCHEN_PRINTER_PORT: "9138"}).length, 2);
  assert.throws(() => bridgeTargets({...live, OPS_LOCAL_TICKET_PRINTER_PORT: "99999"}));
});

test("latido detecta interrupción real incluso con proceso presente", () => {
  assert.equal(pulseState(null, false), "NEVER");
  assert.equal(pulseState(25, true), "HEALTHY");
  assert.equal(pulseState(25, false), "BRIDGE_UNAVAILABLE");
  assert.equal(pulseState(61, true), "STALE");
});

test("no inicia procesos duplicados ni inicia si una dependencia cayó", () => {
  const base = {agentCount: 0, dependenciesReady: true, elapsedSinceLastStartSec: 100};
  assert.equal(shouldLaunchWorker(base), true);
  assert.equal(shouldLaunchWorker({...base, agentCount: 1}), false);
  assert.equal(shouldLaunchWorker({...base, dependenciesReady: false}), false);
  assert.equal(shouldLaunchWorker({...base, elapsedSinceLastStartSec: 20}), false);
});
