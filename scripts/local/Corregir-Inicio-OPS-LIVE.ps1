#requires -Version 5.1
<#
  Inspecciona el arranque conocido de la estación OPS.
  -Apply cambia exclusivamente la URL antigua de Vercel a la URL LAN
  validada de .env.local. No detiene tareas, procesos ni ventanas abiertas.
#>
[CmdletBinding()]
param([switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile = Join-Path $repo '.env.local'
$taskName = 'CafeEpicoOps-StationWatchdog'
$startupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'CafeEpicoOps-Station.cmd'
$backupDir = Join-Path $env:LOCALAPPDATA 'CafeEpicoOps\Guardian'
$legacyUrl = 'https://cafe-epico-ops.vercel.app/pos'

if (!(Test-Path -LiteralPath $envFile)) { throw 'No existe .env.local LIVE. No se cambio el arranque.' }
$origins = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^APP_ORIGIN\s*=' })
if ($origins.Count -ne 1) { throw 'APP_ORIGIN debe aparecer una vez en .env.local.' }
$base = (($origins[0] -split '=', 2)[1]).Trim().Trim('"').Trim("'").TrimEnd('/')
$uri = $null
if (!([uri]::TryCreate($base, [UriKind]::Absolute, [ref]$uri))) {
  throw 'APP_ORIGIN no es una URL valida. No se cambio el arranque.'
}
$ip = [System.Net.IPAddress]::None
if ($uri.Scheme -ne 'https' -or $uri.Port -ne 8443 -or
    $uri.AbsolutePath -ne '/' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
    ![System.Net.IPAddress]::TryParse($uri.Host, [ref]$ip) -or
    $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'APP_ORIGIN debe ser https://IP_LAN_PRIVADA:8443 sin ruta ni parametros.'
}
$bytes = $ip.GetAddressBytes()
$private = $bytes[0] -eq 10 -or
  ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
  ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
if (!$private) { throw 'APP_ORIGIN no apunta a una IP privada de LAN.' }
$assigned = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $uri.Host -ErrorAction SilentlyContinue |
  Where-Object { $_.AddressState -eq 'Preferred' })
if ($assigned.Count -eq 0) { throw 'La IP de APP_ORIGIN no esta asignada a esta PC.' }
$client = New-Object System.Net.Sockets.TcpClient
try {
  $connect = $client.BeginConnect($uri.Host, 8443, $null, $null)
  if (!$connect.AsyncWaitHandle.WaitOne(3500)) { throw 'El HTTPS local no escucha en APP_ORIGIN:8443.' }
  $client.EndConnect($connect)
} finally { $client.Dispose() }

$localUrl = $base + '/pos'
$oldPattern = '(?i)-OpsUrl\s+(?:"https://cafe-epico-ops[.]vercel[.]app/pos"|https://cafe-epico-ops[.]vercel[.]app/pos)(?=\s|$)'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Host 'ARRANQUE: No se encontro la tarea StationWatchdog.' -ForegroundColor Yellow
  if (Test-Path -LiteralPath $startupFile) {
    $startupText = Get-Content -LiteralPath $startupFile -Raw
    if ($startupText -match 'Estacion-OPS[.]ps1' -and [regex]::IsMatch($startupText, $oldPattern)) {
      if (!$Apply) {
        Write-Host ('ARRANQUE: archivo de Inicio apunta a Vercel; recomendado: ' + $localUrl) -ForegroundColor Yellow
        return
      }
      New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
      $backupFile = Join-Path $backupDir ('backup-station-startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.cmd')
      Copy-Item -LiteralPath $startupFile -Destination $backupFile -ErrorAction Stop
      try {
        $updatedText = [regex]::Replace($startupText, $oldPattern, ('-OpsUrl "' + $localUrl + '"'))
        Set-Content -LiteralPath $startupFile -Value $updatedText -Encoding ASCII -ErrorAction Stop
        if ((Get-Content -LiteralPath $startupFile -Raw) -notmatch [regex]::Escape($localUrl)) {
          throw 'No se confirmo el cambio en el archivo de Inicio.'
        }
        Write-Host ('ARRANQUE CORREGIDO EN CARPETA INICIO: ' + $localUrl) -ForegroundColor Green
        Write-Host ('Archivo anterior respaldado en: ' + $backupFile)
      } catch {
        Copy-Item -LiteralPath $backupFile -Destination $startupFile -Force -ErrorAction SilentlyContinue
        throw
      }
      return
    }
    Write-Host 'Existe un archivo de Inicio con un destino distinto. No se modifica.' -ForegroundColor Yellow
  }
  Write-Host 'Chrome/PWA podria tener otro inicio automatico. No se cambio nada.'
  return
}

$actions = @($task.Actions)
if ($actions.Count -ne 1 -or $actions[0].Execute -notmatch '(?i)powershell' -or
    $actions[0].Arguments -notmatch 'Estacion-OPS[.]ps1') {
  Write-Host 'ARRANQUE: tarea con accion desconocida; no se cambia.' -ForegroundColor Yellow
  return
}
$original = [string]$actions[0].Arguments
$newArgs = $null
if ($original.Contains($localUrl)) {
  Write-Host ('ARRANQUE: StationWatchdog ya apunta a ' + $localUrl) -ForegroundColor Green
  return
} elseif ([regex]::IsMatch($original, $oldPattern)) {
  $newArgs = [regex]::Replace($original, $oldPattern, ('-OpsUrl "' + $localUrl + '"'))
} elseif ($original -notmatch '(?i)-OpsUrl(?:\s|$)') {
  # Esta versión conocida del script usa Vercel por defecto si no se pasa -OpsUrl.
  $scriptFile = Join-Path $env:LOCALAPPDATA 'CafeEpicoOps\Estacion-OPS.ps1'
  if (!(Test-Path -LiteralPath $scriptFile) -or
      (Get-Content -LiteralPath $scriptFile -Raw) -notmatch [regex]::Escape($legacyUrl)) {
    Write-Host 'ARRANQUE: destino implícito desconocido. No se cambia.' -ForegroundColor Yellow
    return
  }
  $newArgs = $original + ' -OpsUrl "' + $localUrl + '"'
} else {
  Write-Host 'ARRANQUE: URL de la tarea distinta a la antigua conocida. No se cambia.' -ForegroundColor Yellow
  return
}

if (!$Apply) {
  Write-Host ('ARRANQUE: se detecto destino antiguo. Recomendado: ' + $localUrl) -ForegroundColor Yellow
  Write-Host 'Modo de diagnostico: no se cambio la tarea.'
  return
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$backup = Join-Path $backupDir ('backup-station-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
Export-ScheduledTask -TaskName $taskName -ErrorAction Stop |
  Set-Content -LiteralPath $backup -Encoding UTF8
if (!(Test-Path -LiteralPath $backup)) { throw 'No se pudo respaldar StationWatchdog.' }

$oldAction = $actions[0]
try {
  $workingDir = [string]$oldAction.WorkingDirectory
  if ($workingDir) {
    $newAction = New-ScheduledTaskAction -Execute $oldAction.Execute -Argument $newArgs -WorkingDirectory $workingDir
  } else {
    $newAction = New-ScheduledTaskAction -Execute $oldAction.Execute -Argument $newArgs
  }
  Set-ScheduledTask -TaskName $taskName -Action $newAction -ErrorAction Stop | Out-Null
  $updatedTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $readBack = @($updatedTask.Actions)
  if ($readBack.Count -ne 1 -or !$readBack[0].Arguments.Contains($localUrl)) {
    throw 'La tarea no conservo la nueva direccion.'
  }
  Write-Host ('ARRANQUE CORREGIDO PARA EL PROXIMO INICIO: ' + $localUrl) -ForegroundColor Green
  Write-Host ('Tarea respaldada en: ' + $backup)
  Write-Host 'No se cerro ninguna ventana ni se reinicio la tarea actualmente en ejecucion.'
} catch {
  try { Set-ScheduledTask -TaskName $taskName -Action $oldAction -ErrorAction Stop | Out-Null }
  catch { Write-Warning 'No se pudo restaurar la accion original: revisar backup XML.' }
  throw
}
