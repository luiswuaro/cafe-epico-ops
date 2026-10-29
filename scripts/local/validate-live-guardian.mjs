import {readFileSync} from "node:fs";
import assert from "node:assert/strict";

const root = "scripts/local/";
const installer = readFileSync(root + "Instalar-OPS-Guardian.ps1", "utf8");
const probe = readFileSync(root + "print-guardian-health.mjs", "utf8");
const core = readFileSync(root + "print-guardian-core.mjs", "utf8");

for (const key of ["Export-ScheduledTask", "Disable-ScheduledTask",
  "Enable-ScheduledTask", "MultipleInstances IgnoreNew", "Get-AgentProcesses",
  "Can-AttemptLaunch", "Start-ScheduledTask", "-AtLogOn", "-Status",
]) assert.ok(installer.includes(key.replace("-Status", "Status")), key);

assert.match(installer, /Start-Sleep -Seconds 30/);
assert.match(installer, /AGENT_RUNNING_/);
assert.ok(!/Stop-Process\b/.test(installer), "Guardian no debe matar trabajadores con impresión ambigua");
assert.ok(!probe.includes('"/print"') && !probe.includes("'/print'"),
  "La sonda no debe llamar al endpoint de impresión");
assert.doesNotMatch(probe, /op:\s*["'](?:CLAIM|FINISH|ACK|HEARTBEAT)["']/,
  "La sonda no altera estado de los trabajos");
assert.match(probe, /SELECT|select/);
assert.match(core, /DB_NOT_LOCAL_LIVE/);
console.log("OPS Guardian: revisión estática PASS (revisión Windows pendiente)");
