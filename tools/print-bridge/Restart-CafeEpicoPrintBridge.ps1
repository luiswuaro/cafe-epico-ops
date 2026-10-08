$ErrorActionPreference = "Stop"

$taskName = "CafeEpicoOps-PrintBridge"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "No existe la tarea $taskName. Ejecuta primero Install-CafeEpicoPrintBridge.ps1."
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Milliseconds 800

Write-Host "Puente ESC/POS reiniciado." -ForegroundColor Green
