#requires -Version 5.1
# Cafe Epico OPS: preflight local, instalacion opt-in del conector privado.
# No cambia caja, ventas, DB, impresora, firewall, Caddy ni variables de OPS.
[CmdletBinding()]
param(
  [string]$OpsPath = '',
  [switch]$InstalarConector
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$ok, [string]$message) {
  if (-not $ok) { throw ('BLOQUEADO: ' + $message) }
  Write-Host ('OK: ' + $message) -ForegroundColor Green
}

function Find-OpsFolder {
  param([string]$Selected)
  if ($Selected) {
    $candidate = [System.IO.Path]::GetFullPath($Selected)
    if (-not (Test-Path -LiteralPath (Join-Path $candidate '.env.local') -PathType Leaf)) {
      throw 'La carpeta -OpsPath no contiene .env.local. Revisa que sea OPS LIVE.'
    }
    return $candidate
  }
  $candidates = @(
    (Join-Path $env:USERPROFILE 'Documents\GitHub\cafe-epico-ops-live'),
    (Join-Path $env:USERPROFILE 'Documents\GitHub\cafe-epico-ops-qa'),
    (Join-Path $env:USERPROFILE 'Documents\GitHub\cafe-epico-ops'),
    (Get-Location).Path
  )
  if (Test-Path -LiteralPath (Join-Path $candidates[0] '.env.local') -PathType Leaf) {
    return $candidates[0]
  }
  $found = @($candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ '.env.local') -PathType Leaf } | Select-Object -Unique)
  if ($found.Count -ne 1) {
    throw 'No pude identificar UNA sola carpeta LIVE; ejecuta de nuevo con -OpsPath "RUTA_DE_TU_OPS".'
  }
  return $found[0]
}

function Find-Cloudflared {
  $cmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $paths = @()
  if (${env:ProgramFiles}) { $paths += (Join-Path ${env:ProgramFiles} 'cloudflared\cloudflared.exe') }
  if (${env:ProgramFiles(x86)}) { $paths += (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe') }
  if ($env:LOCALAPPDATA) { $paths += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe') }
  foreach ($candidate in $paths) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

function Get-HttpStatus([string]$url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 3
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw ('HTTPS/TLS falló en la ruta de prueba. No desactivar validacion de certificados: ' + $url)
  }
}

try {
  Write-Host 'CAFE EPICO - ACCESO REMOTO PRIVADO SIN DOMINIO' -ForegroundColor Cyan
  Write-Host 'Primero se realizan comprobaciones locales; sin cambios en ventas.'
  $root = Find-OpsFolder -Selected $OpsPath
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { $node = Get-Command node -ErrorAction Stop }
  if ($InstalarConector -and (Split-Path -Path $root -Leaf).ToLowerInvariant() -ne 'cafe-epico-ops-live') {
    throw 'Activacion restringida a la carpeta oficial cafe-epico-ops-live; especifica -OpsPath correcto.'
  }
  $probe = Join-Path $PSScriptRoot 'remote-owner-preflight.mjs'
  Assert-True (Test-Path -LiteralPath $probe -PathType Leaf) 'El paquete incluye el verificador de OPS.'

  $rawReport = & $node.Source $probe --root $root --json
  $probeExit = $LASTEXITCODE
  $report = ($rawReport | Out-String | ConvertFrom-Json)
  foreach ($check in $report.checks) {
    if ($check.ok) { Write-Host ('OK: ' + $check.id) -ForegroundColor Green }
    else { Write-Host ('FALTA: ' + $check.id + ' - ' + $check.detail) -ForegroundColor Yellow }
  }
  Assert-True ($probeExit -eq 0 -and $report.ready) 'Configuracion de OPS/Auth/Caddy coherente.'
  $ip = [string]$report.ip
  $uri = [uri]$report.origin

  $localIp = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ip -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' })
  Assert-True ($localIp.Count -gt 0) 'La IP configurada esta asignada actualmente a Windows.'

  # Bloquear puertos internos publicados en LAN / todas las interfaces.
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
  $internal = @(3000, 5432, 8000, 18000, 9137, 9138)
  $exposed = @($listeners | Where-Object {
    $_.LocalPort -in $internal -and $_.LocalAddress -notin @('127.0.0.1', '::1')
  })
  Assert-True ($exposed.Count -eq 0) 'Los puertos internos no escuchan fuera de loopback.'

  $gateway = @($listeners | Where-Object { $_.LocalPort -eq 8443 -and $_.LocalAddress -eq $ip })
  Assert-True ($gateway.Count -gt 0) 'Caddy esta escuchando en la IP exacta y puerto 8443.'

  $loginStatus = Get-HttpStatus ($report.origin + '/login')
  Assert-True ($loginStatus -eq 200) 'Login accesible por HTTPS con certificado validado.'
  $authStatus = Get-HttpStatus ($report.origin + '/auth/v1/health')
  Assert-True ($authStatus -eq 200) 'Auth local responde por el mismo origen HTTPS.'
  $printStatus = Get-HttpStatus ($report.origin + '/api/local-print-agent')
  Assert-True ($printStatus -eq 403) 'Agente de impresion bloqueado a peticiones externas.'

  Write-Host ('Objetivo: ' + $report.origin) -ForegroundColor Cyan
  Write-Host ('Ruta Cloudflare Tunnel CIDR: ' + $report.cidr)
  Write-Host 'Puerto unico autorizado: TCP 8443'

  $service = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
  if ($service) {
    Write-Host ('Conector Windows existente: ' + $service.Status) -ForegroundColor Yellow
    if ($InstalarConector) { throw 'Ya existe servicio cloudflared: no se reemplaza automaticamente.' }
  }

  if (-not $InstalarConector) {
    Write-Host ''
    Write-Host 'PREPARACION LOCAL APROBADA; AUN NO HAY ACCESO REMOTO.' -ForegroundColor Green
    Write-Host 'Falta configurar en Cloudflare: tunnel + ruta /32, Access IP:8443, bloqueo Gateway, MFA, dos dispositivos.'
    Write-Host 'Al terminar esas politicas, ejecuta ESTE MISMO archivo con -InstalarConector.'
    exit 0
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  Assert-True ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'PowerShell elevado como administrador.'
  Write-Host ''
  Write-Host 'Antes de activar, Cloudflare debe tener ruta /32, Access restringido y Gateway de BLOQUEO con excepcion TCP 8443.' -ForegroundColor Yellow
  Write-Host 'El programa no puede comprobar tus politicas Cloudflare sin autorizacion de esa cuenta.'
  $confirmed = Read-Host 'Si ya comprobaste MFA, acceso solo Luis/Mildrett, politica DENY, y ruta exacta, escribe POLITICAS LISTAS'
  if ($confirmed -cne 'POLITICAS LISTAS') { throw 'No se autorizo instalar el conector.' }

  $exe = Find-Cloudflared
  if (-not $exe) {
    $winget = Get-Command winget.exe -ErrorAction Stop
    Write-Host 'Instalando conector oficial mediante WinGet...'
    & $winget.Source install --id Cloudflare.cloudflared --exact --silent --accept-package-agreements --accept-source-agreements
    Assert-True ($LASTEXITCODE -eq 0) 'Paquete cloudflared instalado mediante WinGet.'
    $exe = Find-Cloudflared
  }
  Assert-True ([bool]$exe) 'Conector cloudflared localizado.'
  & $exe --version | Select-Object -First 1 | Write-Host

  Write-Host 'Pega el token del tunel privado de Cloudflare (no se muestra ni se guarda en el repositorio).'
  $secureToken = Read-Host 'Token del tunnel' -AsSecureString
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    Assert-True ($token.Length -gt 100 -and $token -match '^[-_A-Za-z0-9.]+$') 'Token recibido en memoria, sin mostrar su valor.'
    # Cloudflare necesita el token como argumento al instalar el servicio.
    # Sera visible brevemente para administradores locales en la lista de procesos.
    & $exe service install $token *> $null
    $installExit = $LASTEXITCODE
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Remove-Variable token, secureToken -ErrorAction SilentlyContinue
  }
  Assert-True ($installExit -eq 0) 'Conector instalado como servicio Windows.'
  $service = Get-Service -Name cloudflared -ErrorAction Stop
  if ($service.Status -ne 'Running') { Start-Service -Name cloudflared -ErrorAction Stop }
  $service = Get-Service -Name cloudflared -ErrorAction Stop
  Assert-True ($service.Status -eq 'Running') 'Servicio Cloudflare Tunnel activo.'

  Write-Host ''
  Write-Host 'CONECTOR INSTALADO. NO ES AUN UNA PRUEBA DE ACCESO REMOTO.' -ForegroundColor Green
  Write-Host 'Ultima prueba: desde datos moviles con WARP, abrir URL privada y confirmar bloqueos de un usuario no autorizado.'
  Write-Host 'No modificar IP, certificado ni firewall mientras no terminen las pruebas.'
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'No se modificaron ventas, recetas, impresora ni base de datos.' -ForegroundColor Yellow
  exit 2
}
