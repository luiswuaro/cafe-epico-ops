[CmdletBinding()]
param(
 [ValidateSet('Auto','Chrome','Brave','Edge')][string]$Browser='Auto',
 [switch]$Watch,
 [switch]$Uninstall
)
$ErrorActionPreference='Stop'
$folder=Join-Path $env:LOCALAPPDATA 'CafeEpicoOps'
$installed=Join-Path $folder 'Estacion-OPS.ps1'
$log=Join-Path $folder 'estacion-ops.log'
$taskName='CafeEpicoOps-StationWatchdog'
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'CafeEpicoOps-Station.cmd'
$url='https://cafe-epico-ops.vercel.app/pos'
function Log([string]$msg){try{Add-Content $log ((Get-Date -Format s)+' '+$msg) -Encoding UTF8}catch{}}
function ResolveBrowser([string]$name) {
 $x86=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
 $suffix=@{Chrome='Google\Chrome\Application\chrome.exe';Brave='BraveSoftware\Brave-Browser\Application\brave.exe';Edge='Microsoft\Edge\Application\msedge.exe'}
 $choices=if($name -eq 'Auto'){@('Chrome','Brave','Edge')}else{@($name)}
 foreach($candidate in $choices){
  foreach($dir in @($env:ProgramFiles,$x86,$env:LOCALAPPDATA)){
   if(-not $dir){continue}
   $exe=Join-Path $dir $suffix[$candidate]
   if(Test-Path $exe){return @{Name=$candidate;Exe=$exe}}
  }
 }
 throw 'No encuentro Chrome, Brave ni Edge instalado.'
}
function StartBridges {
 foreach($name in @('CafeEpicoOps-PrintBridge','CafeEpicoOps-PrintBridge-Barra')){
  $t=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($t -and $t.State -ne 'Running'){
   try{Start-ScheduledTask -TaskName $name;Log ('Puente iniciado '+$name)}
   catch{Log ('Puente no disponible '+$name)}
  }
 }
}
if($Uninstall){
 if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
 }
 Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue
 Write-Host 'Estación desinstalada. Puente y token sin cambios.'
 exit
}
if($Watch){
 $browser=ResolveBrowser $Browser
 $last=[datetime]::MinValue
 Log 'Inicia supervisor'
 while($true){
  try{
   StartBridges
   $open=@(Get-Process -Name chrome,brave,msedge -ErrorAction SilentlyContinue |
    Where-Object {$_.MainWindowTitle -match 'Caf[eé]\s*[eé]pico\s*Ops'})
   if($open.Count -eq 0 -and ((Get-Date)-$last).TotalSeconds -ge 60){
    Start-Process -FilePath $browser.Exe -ArgumentList @(
      ('--app='+$url),
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    )
    $last=Get-Date
    Log 'Ventana OPS abierta'
   }
  }catch{Log $_.Exception.Message}
  Start-Sleep -Seconds 20
 }
}
$browser=ResolveBrowser $Browser
New-Item -ItemType Directory -Path $folder -Force | Out-Null
if($PSCommandPath -ne $installed){Copy-Item -LiteralPath $PSCommandPath -Destination $installed -Force}
try {
 powercfg.exe /change standby-timeout-ac 0
 if($LASTEXITCODE -ne 0){throw 'No se pudo cambiar powercfg'}
 Write-Host 'OK: suspensión deshabilitada en corriente alterna.' -ForegroundColor Green
}catch{Write-Warning 'Configura manualmente suspensión: Windows > Sistema > Energía.'}
$argsForWorker='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$installed+'" -Watch -Browser '+$browser.Name
$taskCreated=$false
try{
 $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $act=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argsForWorker
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
 $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
 $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
 Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trigger -Settings $settings -Principal $principal -Description 'Cafe Epico OPS: caja e impresora' -Force -ErrorAction Stop | Out-Null
 Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue
 Start-ScheduledTask -TaskName $taskName
 $taskCreated=$true
}catch{
 Write-Warning 'No se pudo crear tarea; configurando carpeta de Inicio.'
 $cmd='@echo off'+[Environment]::NewLine+'start "" /min powershell.exe '+$argsForWorker
 Set-Content -LiteralPath $startup -Value $cmd -Encoding ASCII
 Start-Process -FilePath 'powershell.exe' -ArgumentList $argsForWorker -WindowStyle Hidden
}
Write-Host ''
Write-Host 'CAFE EPICO OPS: ESTACION CONFIGURADA' -ForegroundColor Cyan
Write-Host ('Navegador: '+$browser.Name)
Write-Host ('Inicio: '+$(if($taskCreated){'Tarea de Windows'}else{'Carpeta Inicio'}))
Write-Host 'Supervisión de ventana: cada 20 segundos.'
Write-Host ('Registro: '+$log)
Write-Host 'Verifica una vez: POS > Impresora > Activar estación de caja.'
Write-Host 'Esta solución mantiene una ventana del POS; todavía depende del navegador.'
