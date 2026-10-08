param(
  [string]$PrinterName = "POS-58 (copy 1)",
  [int]$Port = 9137,
  [switch]$ResetToken
)

$ErrorActionPreference = "Stop"

$bridgePath = Join-Path $PSScriptRoot "CafeEpicoPrintBridge.ps1"
if (-not (Test-Path $bridgePath)) {
  throw "No se encontro CafeEpicoPrintBridge.ps1 junto al instalador."
}

$configDir = Join-Path $env:LOCALAPPDATA "CafeEpicoOps"
$configPath = Join-Path $configDir "print-bridge.json"
$taskName = "CafeEpicoOps-PrintBridge"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$existingConfig = $null
if (Test-Path $configPath) {
  try {
    $existingConfig = Get-Content -Path $configPath -Raw | ConvertFrom-Json
  }
  catch {
    $existingConfig = $null
  }
}

if (
  -not $ResetToken -and
  $null -ne $existingConfig -and
  -not [string]::IsNullOrWhiteSpace([string]$existingConfig.token)
) {
  $token = [string]$existingConfig.token
} else {
  $token = [guid]::NewGuid().ToString("N")
}

@{
  printerName = $PrinterName
  port = $Port
  token = $token
  bridgePath = $bridgePath
  installedAt = if ($null -ne $existingConfig -and $existingConfig.installedAt) {
    [string]$existingConfig.installedAt
  } else {
    (Get-Date).ToString("o")
  }
  updatedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

$quotedBridge = '"' + $bridgePath + '"'
$quotedPrinter = '"' + $PrinterName + '"'
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedBridge -PrinterName $quotedPrinter -Port $Port -Token $token"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Puente local ESC/POS de Cafe Epico Ops" | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Milliseconds 800

Write-Host ""
Write-Host "Cafe Epico Print Bridge instalado." -ForegroundColor Green
Write-Host "Impresora : $PrinterName"
Write-Host "URL       : http://127.0.0.1:$Port"
Write-Host "Token     : $token" -ForegroundColor Yellow
if ($ResetToken) {
  Write-Host "Token regenerado manualmente." -ForegroundColor Yellow
} elseif ($null -ne $existingConfig -and $existingConfig.token) {
  Write-Host "Se reutilizo el token existente." -ForegroundColor Green
}
Write-Host "Config    : $configPath"
Write-Host ""
Write-Host "Guarda el token en POS > Impresora."
Write-Host "A partir del proximo inicio de sesion el puente arrancara oculto automaticamente."
