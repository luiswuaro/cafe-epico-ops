param(
  [ValidateSet("Tickets", "Barra")][string]$Instance = "Tickets"
)
$ErrorActionPreference = "Stop"

$taskName = if ($Instance -eq "Barra") { "CafeEpicoOps-PrintBridge-Barra" } else { "CafeEpicoOps-PrintBridge" }
$configFile = if ($Instance -eq "Barra") { "print-bridge-barra.json" } else { "print-bridge.json" }
$configPath = Join-Path (Join-Path $env:LOCALAPPDATA "CafeEpicoOps") $configFile

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

if (Test-Path $configPath) {
  Remove-Item $configPath -Force
}

Write-Host "Puente de impresion [$Instance] desinstalado; el otro permanece intacto." -ForegroundColor Green
