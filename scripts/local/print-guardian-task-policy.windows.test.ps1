#requires -Version 5.1
# Prueba sin tareas reales, servicios ni cambios de impresora.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'print-guardian-task-policy.ps1')

$testRoot = Join-Path $env:TEMP ('epico-guardian-policy-' + [guid]::NewGuid().ToString('N'))
$residentDir = Join-Path $testRoot '.local\live-control'
New-Item -ItemType Directory -Path $residentDir -Force | Out-Null
try {
  $resident = Join-Path $residentDir 'manage-live.ps1'
  Set-Content -LiteralPath $resident -Value "# Supervisor de prueba`nparam([string]`$Action)" -Encoding UTF8
  $trustedHash = (Get-FileHash -LiteralPath $resident -Algorithm SHA256).Hash
  $envFile = Join-Path $testRoot '.env.local'
  $worker = Join-Path $testRoot 'scripts\local\print-agent.mjs'
  $validArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $resident + '" -Action RunPrint'
  $action = [pscustomobject]@{
    Execute = (Join-Path $PSHOME 'powershell.exe')
    Arguments = $validArguments
    WorkingDirectory = $testRoot
  }
  $task = [pscustomobject]@{Actions = @($action)}
  function Mode($entry) {
    Get-EpicoPrintTaskMode -Task $entry -Repo $testRoot -EnvFile $envFile -Worker $worker -TrustedSupervisorHash $trustedHash
  }

  if ((Mode $task) -ne 'MANAGE_LIVE') { throw 'No reconocio supervisor legitimo.' }
  $action.Arguments = $validArguments.Replace('RunPrint', 'StopPrint')
  if ((Mode $task) -ne 'UNKNOWN') { throw 'Acepto accion StopPrint.' }
  $action.Arguments = $validArguments
  Add-Content -LiteralPath $resident -Value '# archivo modificado'
  if ((Mode $task) -ne 'UNKNOWN') { throw 'Acepto supervisor modificado.' }
  $direct = [pscustomobject]@{Actions = @([pscustomobject]@{
    Execute = 'C:\Program Files\nodejs\node.exe'
    Arguments = ('--env-file="' + $envFile + '" "' + $worker + '"')
    WorkingDirectory = $testRoot
  })}
  if ((Mode $direct) -ne 'DIRECT_AGENT') { throw 'No reconocio tarea directa conocida.' }
  if ((Mode $null) -ne 'NONE') { throw 'No reconocio ausencia de tarea.' }
  Write-Host 'PASS: 5 escenarios de reconocimiento de tareas sin cambios externos.' -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
