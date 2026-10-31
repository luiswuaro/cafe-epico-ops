#requires -Version 5.1
# Funciones puras de reconocimiento de la tarea de impresion existente.
# No registra, ejecuta, detiene ni modifica tareas.
function Get-EpicoPrintTaskMode {
  [CmdletBinding()]
  param(
    [AllowNull()]$Task,
    [Parameter(Mandatory = $true)][string]$Repo,
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$Worker,
    [Parameter(Mandatory = $true)][string]$TrustedSupervisorHash
  )

  if ($null -eq $Task) { return 'NONE' }
  $actions = @($Task.Actions)
  if ($actions.Count -ne 1) { return 'UNKNOWN' }
  $action = $actions[0]
  if (([string]$action.WorkingDirectory).TrimEnd('\') -ine $Repo.TrimEnd('\')) { return 'UNKNOWN' }

  $exeName = [IO.Path]::GetFileName([string]$action.Execute)
  $arguments = [string]$action.Arguments
  $directArguments = '--env-file="' + $EnvFile + '" "' + $Worker + '"'
  if ($exeName -ieq 'node.exe' -and $arguments -ieq $directArguments) {
    return 'DIRECT_AGENT'
  }

  $resident = Join-Path $Repo '.local\live-control\manage-live.ps1'
  $expectedArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' +
    $resident + '" -Action RunPrint'
  if ($exeName -ine 'powershell.exe' -or $arguments -ine $expectedArguments) { return 'UNKNOWN' }
  if (!(Test-Path -LiteralPath $resident -PathType Leaf)) { return 'UNKNOWN' }
  try {
    $actualHash = (Get-FileHash -LiteralPath $resident -Algorithm SHA256 -ErrorAction Stop).Hash
    if ($actualHash -ine $TrustedSupervisorHash) { return 'UNKNOWN' }
  } catch { return 'UNKNOWN' }
  return 'MANAGE_LIVE'
}
