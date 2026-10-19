#requires -Version 5.1
<#
 Café Épico OPS: prueba LAN autoexpirable, sin acceso a POS ni bases de datos.
 Distingue Wi-Fi de USB tethering. El firewall temporal solo admite LocalSubnet
 y una dirección IPv4 privada asignada a esta PC.
#>
[CmdletBinding()]
param(
  [switch]$OpenTemporaryFirewall,
  [ValidateRange(1024,65535)][int]$Port=47835,
  [string]$InterfaceAlias=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$probe=Join-Path $root 'scripts\local\lan-probe.mjs'
if(!(Test-Path -LiteralPath $probe)){throw 'Falta la sonda LAN.'}
$null=Get-Command node -ErrorAction Stop
$version=(& node --version).Trim()
if([int]([regex]::Match($version,'\d+').Value) -lt 22){
  throw ('Requiere Node 22+. Actual: '+$version)
}
$candidates=@(Get-NetIPConfiguration | Where-Object {
  $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address
})
$eligible=@()
foreach($adapter in $candidates){
  foreach($address in @($adapter.IPv4Address)){
    if($address.IPv4Address -match '^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$'){
      $eligible+= [pscustomobject]@{
        Alias=[string]$adapter.InterfaceAlias
        Ip=[string]$address.IPv4Address
        Prefix=[int]$address.PrefixLength
        Gateway=if($adapter.IPv4DefaultGateway){[string]$adapter.IPv4DefaultGateway.NextHop}else{'(sin gateway)'}
        IsWifi=([string]$adapter.InterfaceAlias -match 'Wi.?Fi|Wireless|WLAN|Inal[aá]mbric')
        Description=[string]$adapter.NetAdapter.InterfaceDescription
      }
    }
  }
}
if($eligible.Count -lt 1){throw 'No encontré adaptador activo con IP privada. Verificar antena Wi-Fi.'}
Write-Host '=== Café Épico · Prueba de antena y conexión LAN ===' -ForegroundColor Cyan
foreach($n in $eligible){
  $type=if($n.IsWifi){'Wi-Fi'}else{'Ethernet/USB/otra'}
  Write-Host (' * '+$n.Alias+' | '+$type+' | '+$n.Ip+'/'+$n.Prefix+' | Gateway '+$n.Gateway)
}
$selected=@()
if($InterfaceAlias){
  $selected=@($eligible | Where-Object {$_.Alias -eq $InterfaceAlias})
  if($selected.Count -ne 1){throw 'Adaptador no encontrado o ambiguo. Usa -InterfaceAlias con el nombre exacto listado.'}
}else{
  $wifi=@($eligible | Where-Object {$_.IsWifi})
  if($wifi.Count -ge 1){$selected=@($wifi[0])}
  elseif($eligible.Count -eq 1){$selected=@($eligible[0])}
  else{throw 'Varias interfaces sin Wi-Fi identificado. Repite con -InterfaceAlias.'}
}
$n=$selected[0];$ip=$n.Ip
Write-Host ''
Write-Host ('Interfaz de prueba: '+$n.Alias+' ('+$ip+')') -ForegroundColor Green
if(!$n.IsWifi){
  Write-Host 'AVISO: no es Wi-Fi detectado. USB tethering puede dar internet sin acceso directo desde otros celulares.' -ForegroundColor Yellow
}
Write-Host 'No se conecta a Supabase, Vercel ni ninguna API comercial.'
Write-Host ('Desde ambos celulares, con datos móviles APAGADOS y en el mismo Wi-Fi, abre: http://'+$ip+':'+$Port+'/')
Write-Host 'Ambos deben mostrar CONEXIÓN LOCAL CONFIRMADA.'
Write-Host 'Si falla: revisar aislamiento AP/clientes del hotel, VLAN o firewall Windows.'
Write-Host 'Ctrl+C detiene; el servidor cierra solo a los 15 minutos.'
Write-Host ''
$ruleName='CafeEpico-Temporary-LAN-Probe-'+[Guid]::NewGuid().ToString('N')
$ruleCreated=$false
try{
  if($OpenTemporaryFirewall){
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
      throw '-OpenTemporaryFirewall requiere PowerShell como Administrador.'
    }
    $ruleArgs=@{DisplayName=$ruleName;Direction='Inbound';Action='Allow';
      Protocol='TCP';LocalPort=$Port;LocalAddress=$ip;RemoteAddress='LocalSubnet';Profile='Any'}
    New-NetFirewallRule @ruleArgs | Out-Null
    $ruleCreated=$true
    Write-Host 'Firewall temporal habilitado sólo para IP elegida y LocalSubnet.' -ForegroundColor Yellow
  }else{
    Write-Host 'Si Windows bloquea: repetir como Administrador con -OpenTemporaryFirewall.' -ForegroundColor Yellow
  }
  & node $probe $Port $ip
  if($LASTEXITCODE -ne 0){throw ('Prueba de LAN terminó con error '+$LASTEXITCODE)}
}finally{
  if($ruleCreated){
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    Write-Host 'Regla temporal de firewall eliminada.'
  }
}
