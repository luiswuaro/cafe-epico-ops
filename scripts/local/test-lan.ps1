#requires -Version 5.1
<#
  Diagnóstico de red para Café Épico OPS, Windows 10/11.
  No se conecta a servicios externos ni lee contraseñas.
  El puerto de diagnóstico sirve SOLO un mensaje público, NO expone OPS.
  -OpenTemporaryFirewall: abre únicamente TCP 47835 desde LocalSubnet,
  durante esta ejecución; requiere PowerShell como Administrador.
#>
[CmdletBinding()]
param(
  [switch]$OpenTemporaryFirewall,
  [ValidateRange(1024,65535)][int]$Port = 47835
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$probe = Join-Path $repoRoot 'scripts\local\lan-probe.mjs'
if (!(Test-Path -LiteralPath $probe)) { throw 'No encuentro scripts/local/lan-probe.mjs.' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (!$node) {
  throw 'Falta Node.js 22+ en Windows. Instálalo primero desde https://nodejs.org/'
}
$nodeVersion = (& node --version).Trim()
if ([int]([regex]::Match($nodeVersion,'\d+').Value) -lt 22) {
  throw ('Node.js '+$nodeVersion+' es demasiado antiguo. Se requiere 22 o superior.')
}

$nets = @(Get-NetIPConfiguration | Where-Object {
  $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and
  $_.IPv4Address -and $_.IPv4DefaultGateway
})
if ($nets.Count -eq 0) {
  throw 'No detecté adaptador activo con IPv4 y puerta de enlace. Revisa el Wi-Fi.'
}

$wifi = @($nets | Where-Object {
  $_.InterfaceAlias -match 'Wi.?Fi|Wireless|WLAN|Inal[aá]mbric'
})
if($wifi.Count -gt 0) { $chosen = $wifi[0] } else { $chosen = $nets[0] }

$ip = @($chosen.IPv4Address)[0].IPv4Address
$prefix = @($chosen.IPv4Address)[0].PrefixLength
Write-Host '=== Diagnóstico Café Épico · PC local ==='
Write-Host ('Interfaz: ' + $chosen.InterfaceAlias)
Write-Host ('IPv4: ' + $ip + '/' + $prefix)
Write-Host ('Node: ' + $nodeVersion)
Write-Host 'No se usan credenciales, ventas, bases de datos ni impresoras.'
Write-Host ''
Write-Host '1. Mantén esta ventana abierta unos minutos.'
Write-Host ('2. Abre desde un celular en el mismo Wi-Fi: http://' + $ip + ':' + $Port + '/')
Write-Host '3. Debe aparecer CONEXIÓN LOCAL CONFIRMADA.'
Write-Host '4. Si no carga, el hotel puede tener aislamiento de clientes o bloqueo de puerto.'
Write-Host '5. Ctrl+C detiene la prueba. El servidor se apaga solo a los 15 min.'
Write-Host ''

$ruleName = 'CafeEpico-Temporary-LAN-Probe-' + [Guid]::NewGuid().ToString('N')
$ruleCreated = $false
try {
  if($OpenTemporaryFirewall){
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $admin = New-Object Security.Principal.WindowsPrincipal($current)
    if(!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
      throw '-OpenTemporaryFirewall requiere abrir PowerShell como Administrador. Sin esa opción, solo se prueba el firewall ya existente.'
    }
    $ruleArguments = @{
      DisplayName=$ruleName;Direction='Inbound';Action='Allow'
      Protocol='TCP';LocalPort=$Port;RemoteAddress='LocalSubnet';Profile='Any'
    }
    New-NetFirewallRule @ruleArguments | Out-Null
    $ruleCreated = $true
    Write-Host 'Regla temporal: solo equipos de la subred local, se retirará al terminar.' -ForegroundColor Yellow
  } else {
    Write-Host 'Si Windows bloquea la conexión, vuelve a ejecutar COMO ADMINISTRADOR con -OpenTemporaryFirewall.' -ForegroundColor Yellow
  }
  & node $probe $Port
  if($LASTEXITCODE -ne 0){ throw ('La prueba terminó con error '+$LASTEXITCODE) }
} finally {
  if($ruleCreated){
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    Write-Host 'Regla temporal del firewall eliminada.'
  }
}
