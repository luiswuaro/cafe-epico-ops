#requires -Version 5.1
# Auditoría local solo lectura: NO instala software, NO toca firewall, NO exporta secretos.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Continue'
$script:missingRequired=New-Object 'System.Collections.Generic.List[string]'
$script:dockerReady=$false

Write-Host '== CAFÉ ÉPICO OPS / PRECHECK LOCAL ==' -ForegroundColor Cyan
Write-Host 'Este diagnóstico NO intenta conectar con Supabase ni modifica producción.'
Write-Host ''

function Check-Bin([string]$name, [string]$argument){
  $cmd=Get-Command $name -ErrorAction SilentlyContinue
  if(!$cmd){
    Write-Host ('FALTA: '+$name) -ForegroundColor Yellow
    $script:missingRequired.Add($name)
    return
  }
  $result=& $name $argument 2>$null
  if($LASTEXITCODE -ne 0){
    Write-Host ('FALLA: '+$name+' existe pero no responde.') -ForegroundColor Yellow
    $script:missingRequired.Add($name)
    return
  }
  Write-Host ($name+': '+($result | Select-Object -First 1))
}
Check-Bin 'node' '--version'
Check-Bin 'npm' '--version'
Check-Bin 'git' '--version'
Check-Bin 'docker' '--version'

Write-Host ''
$os=Get-CimInstance Win32_OperatingSystem
$ram=[math]::Round([double]$os.TotalVisibleMemorySize/1MB,1)
Write-Host ('RAM total: '+$ram+' GB (mínimo oficial Supabase self-host: 4 GB, recomendado 8+ GB)')
$processor=(Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
Write-Host ('CPU lógicas: '+$processor)
$drive=Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue
if($drive){
  $free=[math]::Round($drive.Free/1GB,1)
  Write-Host ('Disco libre en '+$env:SystemDrive+': '+$free+' GB (recomendado 80 GB para pila Supabase completa)')
  if($free -lt 80){
    Write-Host ('AVISO: hay '+$free+' GB libres; se recomiendan 80 GB para la pila completa y copias temporales.') -ForegroundColor Yellow
  }
}
try {
  $dockerInfo = (& docker info --format '{{.ServerVersion}}' 2>$null)
  if($LASTEXITCODE -eq 0 -and $dockerInfo){
    Write-Host ('Docker Engine activo: '+$dockerInfo) -ForegroundColor Green
    $script:dockerReady=$true
  } else {
    Write-Host 'Docker Desktop no está iniciado o no es accesible desde esta cuenta.' -ForegroundColor Yellow
  }
}catch{
  Write-Host 'Docker no está disponible. La instalación local de Supabase todavía NO está lista.' -ForegroundColor Yellow
}
Write-Host ''
$nets=@(Get-NetIPConfiguration | Where-Object {$_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address})
foreach($net in $nets){
  foreach($addr in @($net.IPv4Address)){
    Write-Host ('Red: '+$net.InterfaceAlias+' IPv4 '+$addr.IPv4Address+'/'+$addr.PrefixLength)
  }
}
Write-Host ''
Write-Host 'No se transfirieron datos, no se creó base de datos y no se abrió ningún puerto.'

Write-Host ''
if($script:missingRequired.Count -gt 0 -or !$script:dockerReady){
  Write-Host 'ESTADO: EQUIPO TODAVIA NO LISTO PARA ARRANCAR OPS QA.' -ForegroundColor Yellow
  if($script:missingRequired.Count -gt 0){
    Write-Host ('Faltan o fallan: '+($script:missingRequired -join ', '))
  }
  if(!$script:dockerReady){Write-Host 'Pendiente: Docker Engine iniciado y accesible.'}
  Write-Host 'Diagnostico finalizado. No se instalo ni cambio nada.'
  exit 2
}
Write-Host 'ESTADO: HERRAMIENTAS DISPONIBLES. Falta validar secretos y servicios QA.' -ForegroundColor Green
exit 0
