import assert from "node:assert/strict";
import fs from "node:fs";
const installer=fs.readFileSync("tools/print-bridge/Instalar-EstacionOPS.ps1","utf8");
const worker=fs.readFileSync("app/(employee)/pos/printer/print-station.tsx","utf8");
assert.match(installer,/New-ScheduledTaskTrigger -AtLogOn/);
assert.match(installer,/\$selectedBrowser=ResolveBrowser \$Browser/);
// PowerShell variable names are case-insensitive: $Browser and $browser are the SAME variable.
// Assigning the returned hashtable to it causes ValidateSetFailure at installation.
assert.doesNotMatch(installer,/^\s*\$browser\s*=/im,
  "No sobrescribir el parámetro [ValidateSet] Browser con un objeto");
assert.match(installer,/Get-Process -Name chrome,brave,msedge/);
assert.match(installer,/Start-Process -FilePath \$selectedBrowser\.Exe/);
assert.match(installer,/Start-Sleep -Seconds 20/);
assert.match(installer,/Local\\CafeEpicoOpsStationWatchdog/,
  "Mutex exclusivo: solo un supervisor por sesión");
assert.match(installer,/Get-CimInstance Win32_Process -Filter/,
  "Debe detener las versiones anteriores del supervisor antes de sustituirlas");
const launchStatements=installer.match(/Start-Process -FilePath \$selectedBrowser\.Exe/g)??[];
assert.equal(launchStatements.length,1,"El instalador abre OPS una sola vez");
const monitorLoop=installer.slice(installer.indexOf("  while($true){"),installer.indexOf("\n$selectedBrowser=ResolveBrowser $Browser\nNew-Item"));
assert.ok(monitorLoop.startsWith("  while($true){"));
assert.doesNotMatch(monitorLoop,/Start-Process/,
  "Nunca abrir OPS desde el bucle: la detección de ventana puede fallar y duplicar pantallas");
assert.match(installer,/if\(-not \(Test-OpsRunning\)\)/,
  "Evitar lanzar OPS si ya existe una ventana o un proceso --app");

assert.match(installer,/powercfg\.exe \/change standby-timeout-ac 0/);
assert.match(installer,/CafeEpicoOps-PrintBridge/);
assert.match(installer,/\$env:LOCALAPPDATA/);
assert.match(installer,/\[switch\]\$Uninstall/);
assert.doesNotMatch(installer,/--user-data-dir/);
assert.doesNotMatch(installer,/-ResetToken/);
assert.match(worker,/Date\.now\(\)-24\*60\*60\*1000/);
assert.match(worker,/getPrintStationJobs\(\{since:pollSince\}\)/);
assert.match(worker,/since:pollSince/);
console.log("Estación Windows: PASS (autoarranque, restauración de ventana, puente intacto, ventana de 24h)");
