$ErrorActionPreference = "Stop"

$taskName = "CafeEpicoOps-PrintBridge"
$configDir = Join-Path $env:LOCALAPPDATA "CafeEpicoOps"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

if (Test-Path $configDir) {
  Remove-Item $configDir -Recurse -Force
}

Write-Host "Puente de impresion de Cafe Epico desinstalado." -ForegroundColor Green
