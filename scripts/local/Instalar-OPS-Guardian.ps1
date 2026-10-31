#requires -Version 5.1
<#
  Café Épico OPS Guardian V1 — exclusivamente LIVE local de TEPEXI.
  Sin parámetros: instala la vigilancia al iniciar sesión. -Status: consulta.
  -Uninstall: desinstala la vigilancia y reactiva la tarea anterior si correspondía.
  No crea órdenes, no envía papel ni reimprime comandas pendientes.
#>
[CmdletBinding()]
param([switch]$Watch, [switch]$Status, [switch]$Uninstall)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile = Join-Path $repo '.env.local'
$worker = Join-Path $repo 'scripts\local\print-agent.mjs'
$healthScript = Join-Path $repo 'scripts\local\print-guardian-health.mjs'
$taskPolicy = Join-Path $repo 'scripts\local\print-guardian-task-policy.ps1'
if (!(Test-Path -LiteralPath $taskPolicy -PathType Leaf)) { throw 'Falta politica de tareas LIVE.' }
. $taskPolicy
$guardianTask = 'CafeEpicoOps-LIVE-Guardian'
$legacyTask = 'CafeEpicoOps-LIVE-PrintAgent'
$qaTask = 'CafeEpicoOps-QA-PrintAgent'
# SHA256 del manage-live.ps1 entregado por Luis (31-oct-2026).
# Si el archivo residente cambia, detenerse para revisar su nueva logica.
$trustedSupervisorHash = 'c849944fe4a51e59cf330aa92a00be186beddf61e7ec5d601036e99b8ab05b83'
$dataDir = Join-Path $env:LOCALAPPDATA 'CafeEpicoOps\Guardian'
$logPath = Join-Path $dataDir 'guardian.log'
$historyPath = Join-Path $dataDir 'launch-history.json'
$legacyStatePath = Join-Path $dataDir 'legacy-task-backup.json'
$script:lastBridgeTaskAttempt = [DateTime]::MinValue

function Write-GuardianLog([string]$code) {
  try {
    if (!(Test-Path -LiteralPath $dataDir)) {
      New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ((Get-Date -Format s) + ' ' + $code)
  } catch { }
}

function Get-AgentProcesses {
  $workerPattern = [regex]::Escape($worker)
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
    Where-Object {
      $_.CommandLine -and $_.CommandLine -match 'print-agent[.]mjs' -and
      $_.CommandLine -match $workerPattern
    })
}

function Get-PrintConflictReason {
  $qa = Get-ScheduledTask -TaskName $qaTask -ErrorAction SilentlyContinue
  if ($null -ne $qa -and $qa.State -eq 'Running') { return 'QA_TASK_RUNNING' }
  $workerPattern = [regex]::Escape($worker)
  $other = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
    Where-Object {
      $_.CommandLine -and $_.CommandLine -match 'print-agent[.]mjs' -and
      $_.CommandLine -notmatch $workerPattern
    })
  if ($other.Count -gt 0) { return 'OTHER_PRINT_AGENT_RUNNING' }
  return 'NONE'
}

function Get-LegacyMode {
  $task = Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
  Get-EpicoPrintTaskMode -Task $task -Repo $repo -EnvFile $envFile `
    -Worker $worker -TrustedSupervisorHash $trustedSupervisorHash
}

function Read-Health([string]$mode) {
  if (!(Test-Path -LiteralPath $envFile) -or !(Test-Path -LiteralPath $healthScript)) {
    throw 'Archivos LIVE incompletos. No se puede supervisar impresion.'
  }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $lines = @(& $node ("--env-file=" + $envFile) $healthScript ("--mode=" + $mode) 2>$null)
  if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) { throw 'La sonda de salud LIVE no se ejecuto.' }
  try { return ($lines[-1] | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw 'La sonda LIVE no devolvio un resultado valido.' }
}

function Start-PrinterBridgeTasks($health) {
  if ($health.bridges -eq $true -or $health.bridgeStatus.Count -eq 0) { return }
  $now = [DateTime]::UtcNow
  if (($now - $script:lastBridgeTaskAttempt).TotalSeconds -lt 120) { return }
  $script:lastBridgeTaskAttempt = $now
  $names = @('CafeEpicoOps-PrintBridge', 'CafeEpicoOps-PrintBridge-Barra')
  for ($i = 0; $i -lt [Math]::Min($names.Count, $health.bridgeStatus.Count); $i++) {
    if ($health.bridgeStatus[$i].ready -eq $true) { continue }
    $name = $names[$i]
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -ne $task -and $task.State -ne 'Running' -and $task.State -ne 'Disabled') {
      try { Start-ScheduledTask -TaskName $name -ErrorAction Stop; Write-GuardianLog ('BRIDGE_TASK_STARTED ' + $name) }
      catch { Write-GuardianLog ('BRIDGE_TASK_FAILED ' + $name) }
    }
  }
}

function Can-AttemptLaunch {
  $now = [DateTime]::UtcNow
  $recent = @()
  if (Test-Path -LiteralPath $historyPath) {
    try {
      $stored = @(Get-Content -LiteralPath $historyPath -Raw | ConvertFrom-Json -ErrorAction Stop)
      foreach ($stamp in $stored) {
        $parsed = [DateTime]::MinValue
        if ([DateTime]::TryParse([string]$stamp, [ref]$parsed) -and
            $parsed.ToUniversalTime() -gt $now.AddMinutes(-15)) { $recent += $parsed.ToUniversalTime() }
      }
    } catch { Write-GuardianLog 'ATTEMPT_HISTORY_INVALID'; return $false }
  }
  if ($recent.Count -ge 3) { return $false }
  if ($recent.Count -gt 0 -and ($now - ($recent | Sort-Object -Descending | Select-Object -First 1)).TotalSeconds -lt 90) {
    return $false
  }
  $recent += $now
  # Registrar ANTES de iniciar el proceso: limita reintentos incluso si el supervisor se reinicia.
  ConvertTo-Json -InputObject @($recent | ForEach-Object { $_.ToString('o') }) |
    Set-Content -LiteralPath $historyPath -Encoding UTF8
  return $true
}

function Start-LiveAgent {
  if ((@(Get-AgentProcesses)).Count -ne 0) { return }
  $conflict = Get-PrintConflictReason
  if ($conflict -ne 'NONE') { throw ('Impresion LIVE en espera: ' + $conflict) }
  $mode = Get-LegacyMode
  if ($mode -eq 'UNKNOWN') { throw 'La tarea LIVE existente cambio; revisar antes de iniciar.' }
  if ($mode -ne 'NONE') {
    $task = Get-ScheduledTask -TaskName $legacyTask -ErrorAction Stop
    if ($task.State -eq 'Disabled') { throw 'La tarea LIVE esta deshabilitada.' }
    if ($task.State -ne 'Running') {
      Start-ScheduledTask -TaskName $legacyTask -ErrorAction Stop
      Write-GuardianLog ('KNOWN_LIVE_TASK_RESTART_REQUESTED ' + $mode)
    }
    return
  }
  if (!(Test-Path -LiteralPath $worker)) { throw 'Falta el worker LIVE.' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $tag = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdout = Join-Path $dataDir ('live-' + $tag + '.out.log')
  $stderr = Join-Path $dataDir ('live-' + $tag + '.err.log')
  $arguments = '--env-file="' + $envFile + '" "' + $worker + '"'
  $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $repo `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-GuardianLog ('AGENT_STARTED pid=' + $process.Id)
}

function Start-GuardianWatch {
  $created = $false
  $mutex = [System.Threading.Mutex]::new($true, 'Local\CafeEpicoOpsLivePrintGuardian', [ref]$created)
  if (!$created) { $mutex.Dispose(); return }
  $previous = ''
  try {
    Write-GuardianLog 'WATCH_STARTED'
    while ($true) {
      try {
        $agents = @(Get-AgentProcesses)
        if ($agents.Count -gt 1) {
          $state = 'DUPLICATE_AGENT_REQUIRES_OPERATOR'
        } elseif ($agents.Count -eq 1) {
          $health = Read-Health 'pulse'
          Start-PrinterBridgeTasks $health
          $state = if ($health.pulse -eq 'HEALTHY' -and $health.bridges) {
            'AGENT_HEALTHY'
          } else { 'AGENT_RUNNING_' + $health.reason }
          # Proceso vivo con pulso vencido: no matarlo durante una impresión física.
          # El POS ya muestra una alerta visible; revisión humana requerida.
        } else {
          $health = Read-Health 'preflight'
          Start-PrinterBridgeTasks $health
          $conflict = Get-PrintConflictReason
          $mode = Get-LegacyMode
          if ($conflict -ne 'NONE') {
            $state = 'WAITING_' + $conflict
          } elseif ($mode -eq 'UNKNOWN') {
            $state = 'WAITING_LEGACY_TASK_CHANGED'
          } elseif ($health.dependenciesReady -eq $true -and (Can-AttemptLaunch)) {
            Start-LiveAgent
            $state = 'RECOVERY_STARTED'
          } else {
            $state = 'WAITING_' + $health.reason
          }
        }
        if ($state -ne $previous) { Write-GuardianLog $state; $previous = $state }
      } catch {
        $code = 'WATCH_CHECK_FAILED'
        if ($code -ne $previous) { Write-GuardianLog $code; $previous = $code }
      }
      Start-Sleep -Seconds 30
    }
  } finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
  }
}

function Show-GuardianStatus {
  $task = Get-ScheduledTask -TaskName $guardianTask -ErrorAction SilentlyContinue
  $legacy = Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
  Write-Host ('Guardian: ' + $(if ($null -eq $task) {'NO INSTALADO'} else {$task.State}))
  Write-Host ('Tarea antigua: ' + $(if ($null -eq $legacy) {'NO EXISTE'} else {$legacy.State}))
  Write-Host ('Tipo de tarea LIVE: ' + (Get-LegacyMode))
  Write-Host ('Conflicto de impresion: ' + (Get-PrintConflictReason))
  Write-Host ('Agentes LIVE: ' + (@(Get-AgentProcesses)).Count)
  $health = Read-Health 'preflight'
  Write-Host ('OPS / API: ' + $(if ($health.api -eq $true) {'OK'} else {'ERROR'}))
  Write-Host ('PostgreSQL: ' + $(if ($health.database -eq $true) {'OK'} else {'ERROR'}))
  Write-Host ('Puente ESC/POS: ' + $(if ($health.bridges -eq $true) {'OK'} else {'ERROR'}))
  Write-Host ('Latido: ' + $health.pulse + ' (' + $health.ageSeconds + ' s)')
  if (Test-Path -LiteralPath $logPath) {
    Write-Host 'Ultimos eventos:'
    Get-Content -LiteralPath $logPath -Tail 8
  }
}

function Install-Guardian {
  if (!(Test-Path -LiteralPath $worker) -or !(Test-Path -LiteralPath $healthScript)) {
    throw 'No se encontraron los componentes LIVE de Guardian.'
  }
  $preflight = Read-Health 'preflight'
  if ($preflight.config -eq $true -and $preflight.database -eq $true -and
      $preflight.api -eq $true -and $preflight.bridges -ne $true) {
    # Tras un reinicio, comprobar puentes que realmente estan caidos antes de
    # iniciar sus tareas. Una tarea/puente sano nunca se vuelve a arrancar.
    Start-PrinterBridgeTasks $preflight
    Start-Sleep -Seconds 10
    $preflight = Read-Health 'preflight'
  }
  if ($preflight.config -ne $true -or $preflight.database -ne $true -or
      $preflight.api -ne $true -or $preflight.bridges -ne $true) {
    throw ('PRECHECK BLOQUEADO: ' + $preflight.reason + '. No se alteraron tareas.')
  }
  $agents = @(Get-AgentProcesses)
  if ($agents.Count -gt 1) { throw 'Ya hay multiples agentes LIVE. No cambiar tareas.' }

  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $legacy = Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
  $legacyMode = Get-EpicoPrintTaskMode -Task $legacy -Repo $repo -EnvFile $envFile `
    -Worker $worker -TrustedSupervisorHash $trustedSupervisorHash
  if ($legacyMode -eq 'UNKNOWN') {
    throw 'La tarea LIVE existe pero su accion no coincide con un supervisor verificado. No se modificaron tareas.'
  }
  if ($null -ne $legacy -and $legacy.State -eq 'Disabled') {
    throw 'La tarea LIVE verificada esta deshabilitada. Revisar antes de instalar.'
  }
  $backupPath = $null
  if ($null -ne $legacy) {
    $backupPath = Join-Path $dataDir ('backup-print-task-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
    Export-ScheduledTask -TaskName $legacyTask -ErrorAction Stop |
      Set-Content -LiteralPath $backupPath -Encoding UTF8
    if (!(Test-Path -LiteralPath $backupPath)) { throw 'No se pudo respaldar la tarea antigua.' }
    Write-Host 'Respaldo de tarea LIVE existente: OK' -ForegroundColor Green
  }

  $current = Get-ScheduledTask -TaskName $guardianTask -ErrorAction SilentlyContinue
  if ($null -ne $current) {
    $existing = @($current.Actions)
    if ($existing.Count -ne 1 -or
        ($existing[0].Arguments -notmatch [regex]::Escape($PSCommandPath))) {
      throw 'Existe un Guardian con otra configuracion. No se sobrescribe.'
    }
    if ($current.State -ne 'Running') {
      Start-ScheduledTask -TaskName $guardianTask -ErrorAction Stop
    }
    Write-Host 'GUARDIAN V1: YA INSTALADO. No se modificaron tareas.' -ForegroundColor Green
    return
  }
  $registered = $false
  try {
    if ($null -eq $current) {
      $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
      $exe = Join-Path $PSHOME 'powershell.exe'
      $args = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Watch'
      $action = New-ScheduledTaskAction -Execute $exe -Argument $args -WorkingDirectory $repo
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
      $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
      $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $guardianTask -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description 'Cafe Epico OPS Guardian: supervision segura de impresion LIVE' -ErrorAction Stop | Out-Null
      $registered = $true
    }
    # El Guardian reutiliza la tarea LIVE conocida: no la deshabilita ni la reemplaza.
    @{backup = $backupPath; task = $legacyTask; disabledByGuardian = $false; mode = $legacyMode} |
      ConvertTo-Json | Set-Content -LiteralPath $legacyStatePath -Encoding UTF8
    $guardian = Get-ScheduledTask -TaskName $guardianTask -ErrorAction Stop
    if ($guardian.State -ne 'Running') { Start-ScheduledTask -TaskName $guardianTask -ErrorAction Stop }
    Start-Sleep -Seconds 8
    $now = Get-ScheduledTask -TaskName $guardianTask -ErrorAction Stop
    if ($now.State -ne 'Running') { throw 'Guardian no se mantuvo ejecutandose.' }
    Write-GuardianLog 'INSTALL_OK'
    Write-Host 'GUARDIAN V4: TAREA ACTIVA' -ForegroundColor Green
    Write-Host ('Tarea LIVE verificada y conservada: ' + $legacyMode)
    $conflict = Get-PrintConflictReason
    if ($conflict -ne 'NONE') {
      Write-Warning ('Impresion LIVE sigue en espera porque existe este conflicto: ' + $conflict)
    }
    Write-Host 'El proceso LIVE actual no se interrumpio.'
    Write-Host 'Prueba pendiente: reiniciar Windows y hacer una comanda real.'
  } catch {
    if ($registered) {
      try { Stop-ScheduledTask -TaskName $guardianTask -ErrorAction SilentlyContinue } catch { }
      try { Unregister-ScheduledTask -TaskName $guardianTask -Confirm:$false -ErrorAction Stop } catch { }
    }
    Write-GuardianLog 'INSTALL_ROLLED_BACK'
    throw
  }
}

function Uninstall-Guardian {
  $task = Get-ScheduledTask -TaskName $guardianTask -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    $actions = @($task.Actions)
    if ($actions.Count -ne 1 -or $actions[0].Arguments -notmatch [regex]::Escape($PSCommandPath)) {
      throw 'La tarea Guardian fue modificada: no se desinstala automaticamente.'
    }
    Stop-ScheduledTask -TaskName $guardianTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $guardianTask -Confirm:$false -ErrorAction Stop
  }
  if (Test-Path -LiteralPath $legacyStatePath) {
    $saved = Get-Content -LiteralPath $legacyStatePath -Raw | ConvertFrom-Json
    if ($saved.PSObject.Properties.Name -contains 'disabledByGuardian' -and
        $saved.disabledByGuardian -eq $true -and
        (Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue)) {
      Enable-ScheduledTask -TaskName $legacyTask -ErrorAction Stop | Out-Null
    }
  }
  Write-GuardianLog 'GUARDIAN_UNINSTALLED'
  Write-Host 'Guardian retirado; la tarea LIVE existente no se altero.'
  Write-Host 'No se detuvo el proceso LIVE de impresion que este atendiendo pedidos.'
}

if ($Watch) { Start-GuardianWatch }
elseif ($Status) { Show-GuardianStatus }
elseif ($Uninstall) { Uninstall-Guardian }
else { Install-Guardian }
