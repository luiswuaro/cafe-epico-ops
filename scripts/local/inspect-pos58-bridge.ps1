#requires -Version 5.1
# Diagnostico SOLO LECTURA de la POS-58 y el puente local.
# No instala controladores, no modifica puertos, no muestra tokens y NO imprime.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "=== CAFE EPICO: POS-58 Y PUENTE LOCAL / SOLO LECTURA ===" -ForegroundColor Cyan

try {
  $spooler = Get-Service -Name Spooler
  Write-Host ("Spooler: " + $spooler.Status)
} catch {
  Write-Host "Spooler: sin informacion." -ForegroundColor Yellow
}

try {
  $printers = @(Get-CimInstance -ClassName Win32_Printer |
    Where-Object { $_.Name -like 'POS-58*' })
  foreach ($printer in $printers) {
    Write-Host ("Cola: " + $printer.Name + " | puerto: " + $printer.PortName +
      " | offline: " + $printer.WorkOffline + " | defecto: " + $printer.Default)
  }
  if ($printers.Count -eq 0) {
    Write-Host "PENDIENTE: Windows no devolvio colas POS-58." -ForegroundColor Yellow
  }
} catch {
  Write-Host "PENDIENTE: no se pudieron consultar impresoras Windows." -ForegroundColor Yellow
}

try {
  $pending = @(Get-CimInstance -ClassName Win32_PrintJob |
    Where-Object { $_.Name -match '^POS-58' })
  Write-Host ("Trabajos POS-58 visibles en Windows: " + $pending.Count)
  if ($pending.Count -gt 0) {
    Write-Host "ATENCION: revisar las colas POS-58 antes de ensayos." -ForegroundColor Yellow
  }
} catch {
  Write-Host "PENDIENTE: consulta de trabajos no disponible." -ForegroundColor Yellow
}

foreach ($entry in @(
  @{ Name = 'Tickets'; Config = 'print-bridge.json'; Task = 'CafeEpicoOps-PrintBridge' },
  @{ Name = 'Barra'; Config = 'print-bridge-barra.json'; Task = 'CafeEpicoOps-PrintBridge-Barra' }
)) {
  $task = Get-ScheduledTask -TaskName $entry.Task -ErrorAction SilentlyContinue
  Write-Host ("Tarea " + $entry.Name + ": " + $(if ($null -eq $task) { 'no instalada' } else { [string]$task.State }))
  $path = Join-Path (Join-Path $env:LOCALAPPDATA 'CafeEpicoOps') $entry.Config
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Write-Host ("Puente " + $entry.Name + ": sin configuracion local.")
    continue
  }
  try {
    $cfg = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $port = [int]$cfg.port
    $printer = [string]$cfg.printerName
    $token = [string]$cfg.token
    if ($port -lt 1024 -or $port -gt 65535 -or [string]::IsNullOrWhiteSpace($token)) {
      Write-Host ("Puente " + $entry.Name + ": configuracion incompleta.") -ForegroundColor Yellow
      continue
    }
    Write-Host ("Puente " + $entry.Name + ": " + $printer + " / puerto " + $port + " / token presente (oculto).")
    $headers = @{ 'X-Cafe-Epico-Token' = $token }
    try {
      $result = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:" + $port + "/status") -Headers $headers -TimeoutSec 3
      if ($result.ok -eq $true -and $result.mode -eq 'RAW_ESC_POS') {
        Write-Host ("PASS: " + $entry.Name + " responde en loopback, version " + $result.version + ". NO se imprimio.") -ForegroundColor Green
      } else {
        Write-Host ("PENDIENTE: " + $entry.Name + " responde con protocolo diferente.") -ForegroundColor Yellow
      }
    } catch {
      Write-Host ("PENDIENTE: " + $entry.Name + " no responde con la configuracion guardada.") -ForegroundColor Yellow
    }
  } catch {
    Write-Host ("PENDIENTE: no se pudo revisar " + $entry.Name + ".") -ForegroundColor Yellow
  }
}
Write-Host "FIN: solo consultas; sin cambios ni impresion." -ForegroundColor Cyan
