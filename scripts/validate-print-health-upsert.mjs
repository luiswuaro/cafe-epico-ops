import assert from "node:assert/strict";
import fs from "node:fs";
const hub=fs.readFileSync("app/(employee)/pos/printer/hub-actions.ts","utf8");
const worker=fs.readFileSync("app/(employee)/pos/printer/print-station.tsx","utf8");
const migration=fs.readFileSync("db/migrations/0031_ops_print_station_current_status.sql","utf8");
const schema=fs.readFileSync("src/infrastructure/db/schema.ts","utf8");
const banner=fs.readFileSync("components/print-station-health-banner.tsx","utf8");
const heartbeat=hub.slice(hub.indexOf("export async function heartbeatPrintStation"),
  hub.indexOf("export async function getPrintStationHealth"));
const health=hub.slice(hub.indexOf("export async function getPrintStationHealth"));

assert.match(migration,/CREATE TABLE IF NOT EXISTS pos_print_station_status/);
assert.match(migration,/store_id uuid PRIMARY KEY/);
assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
assert.match(migration,/REVOKE ALL PRIVILEGES.*anon, authenticated/);
assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|DELETE FROM|UPDATE audit_events)\b/i);
assert.match(schema,/export const posPrintStationStatus/);

assert.match(heartbeat,/assertNoPreviewMutation\(\)/);
assert.match(heartbeat,/const \{employee,storeId\}=await principal\(\)/);
assert.match(heartbeat,/allowedSince\(input\.since\)/);
assert.match(heartbeat,/\.insert\(posPrintStationStatus\)/);
assert.match(heartbeat,/\.onConflictDoUpdate\(/);
assert.match(heartbeat,/target:posPrintStationStatus\.storeId/);
assert.doesNotMatch(heartbeat,/\.insert\(auditEvents\)/,
  "A heartbeat must not insert audit events");
assert.match(health,/\.from\(posPrintStationStatus\)/);
assert.match(health,/posPrintStationStatus\.organizationId/);
assert.match(health,/posPrintStationStatus\.storeId/);
assert.doesNotMatch(health,/\.from\(auditEvents\)/,
  "Health must never scan historical heartbeat events");
assert.match(hub,/const HEARTBEAT_TIMEOUT_MS=60\*1000/);
assert.match(worker,/Date\.now\(\)-lastHeartbeat\.current>=20000/);
assert.match(worker,/window\.setInterval\(\(\)=>void tick\(\),4000\)/,
  "Kitchen/receipt jobs must keep the 4-second polling window");
assert.match(hub,/MAX_AUTO_PRINT_AGE_MS=5\*60\*1000/);
assert.match(hub,/pg_advisory_xact_lock/);
assert.match(hub,/POS_PRINT_HUB_CLAIMED/);
assert.match(hub,/POS_PRINT_HUB_DONE/);
assert.match(hub,/POS_PRINT_HUB_FAILED/);
assert.match(hub,/POS_PRINT_HUB_EXPIRED/);
assert.match(worker,/claimPrintStationJob\(job\.key,state\.stationId\)/);
assert.match(worker,/finishPrintStationJob\(job\.key,state\.stationId/);
assert.match(banner,/getPrintStationHealth/);
assert.match(banner,/role="alert"/);
assert.match(banner,/health\.online&&health\.bridgeReady/);

console.log("Print Health: PASS (single private row; 20-second ping; 60-second timeout; 4-second jobs; claim safety intact)");
