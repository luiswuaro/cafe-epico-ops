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
 if($name -eq 'Auto'){
  # Reutilizar el navegador donde OPS ya tiene la sesión y el puente configurados.
  $running=Get-Process -Name chrome,brave,msedge -ErrorAction SilentlyContinue |
   Where-Object {$_.MainWindowTitle -match 'Caf.\s*.pico\s*Ops'} |
   Select-Object -First 1
  if($running){
   $name=switch($running.ProcessName){'brave'{'Brave'}'msedge'{'Edge'}default{'Chrome'}}
  }
 }
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
function Test-OpsRunning {
 # Inspección inicial solamente. No abrir nuevas ventanas durante la jornada.
 $visible=@(Get-Process -Name chrome,brave,msedge -ErrorAction SilentlyContinue |
  Where-Object {$_.MainWindowTitle -match 'Caf.\s*.pico\s*Ops'})
 if($visible.Count -gt 0){return $true}
 # Algunas instalaciones de Brave/Chrome exponen un título vacío en Get-Process.
 try {
  $app=@(Get-CimInstance Win32_Process -ErrorAction Stop |
   Where-Object {$_.Name -in @('chrome.exe','brave.exe','msedge.exe') -and
    $_.CommandLine -match '--app=https://cafe-epico-ops\.vercel\.app(/pos)?'})
  return ($app.Count -gt 0)
 }catch {return $false}
}
if($Watch){
 # Un proceso por sesión Windows incluso si se dispara doble la tarea.
 $createdNew=$false
 $mutex=[System.Threading.Mutex]::new($true,'Local\CafeEpicoOpsStationWatchdog',[ref]$createdNew)
 if(-not $createdNew){$mutex.Dispose();exit 0}
 try {
  $selectedBrowser=ResolveBrowser $Browser
  Log 'Supervisor iniciado; apertura única por sesión'
  StartBridges
  if(-not (Test-OpsRunning)){
   Start-Process -FilePath $selectedBrowser.Exe -ArgumentList @(
    ('--app='+$url),
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
   )
   Log 'OPS abierto una sola vez al iniciar sesión'
  }else{Log 'OPS ya está abierto; no se lanza otra ventana'}
  # JAMÁS lanzar más ventanas dentro del bucle: título/estado de Chrome
  # no son señales suficientemente fiables y provocaron ventanas repetidas.
  while($true){
   try{StartBridges}catch{Log ('Supervisión puente: '+$_.Exception.Message)}
   Start-Sleep -Seconds 20
  }
 }finally{
  $mutex.ReleaseMutex()
  $mutex.Dispose()
 }
}
$selectedBrowser=ResolveBrowser $Browser
New-Item -ItemType Directory -Path $folder -Force | Out-Null
# Sustituir el supervisor anterior antes de instalar la versión sin duplicados.
$oldTask=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($oldTask){Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue}
try {
 $oldWatchers=Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop |
  Where-Object {$_.CommandLine -match 'Estacion-OPS\.ps1' -and $_.CommandLine -match '\-Watch'}
 foreach($process in $oldWatchers){
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
 }
}catch{Log ('No se pudo detener supervisor anterior: '+$_.Exception.Message)}
if($PSCommandPath -ne $installed){Copy-Item -LiteralPath $PSCommandPath -Destination $installed -Force}
try {
 powercfg.exe /change standby-timeout-ac 0
 if($LASTEXITCODE -ne 0){throw 'No se pudo cambiar powercfg'}
 Write-Host 'OK: suspensión deshabilitada en corriente alterna.' -ForegroundColor Green
}catch{Write-Warning 'Configura manualmente suspensión: Windows > Sistema > Energía.'}
$argsForWorker='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$installed+'" -Watch -Browser '+$selectedBrowser.Name
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
Write-Host ('Navegador: '+$selectedBrowser.Name)
Write-Host ('Inicio: '+$(if($taskCreated){'Tarea de Windows'}else{'Carpeta Inicio'}))
Write-Host 'Supervisión de ventana: cada 20 segundos.'
Write-Host ('Registro: '+$log)
Write-Host 'Verifica una vez: POS > Impresora > Activar estación de caja.'
Write-Host 'Esta solución mantiene una ventana del POS; todavía depende del navegador.'
