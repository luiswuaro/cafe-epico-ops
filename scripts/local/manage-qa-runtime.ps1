#requires -Version 5.1
# Control sin ventanas permanentes para la replica QA local.
[CmdletBinding()]
param(
 [ValidateSet('Install','Start','Status','Stop','Uninstall')][string]$Action='Status',
 [switch]$StartNow
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskName='CafeEpicoOps-QA-Server'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dir=Join-Path $root '.local\qa-runtime'
$state=Join-Path $dir 'services.json'
$stopFile=Join-Path $dir 'stop.request'
$envFile=Join-Path $root '.env.local'
$runner=Join-Path $PSScriptRoot 'run-qa-runtime.ps1'
function Assert-Qa {
 if(!(Test-Path -LiteralPath $envFile -PathType Leaf)){throw 'No existe .env.local QA.'}
 Push-Location $root
 try{
  & node ("--env-file="+$envFile) 'scripts/local/guard-qa-config.mjs'
  if($LASTEXITCODE -ne 0){throw 'La configuración QA fue rechazada. No se instala.'}
 }finally{Pop-Location}
 if(!(Test-Path (Join-Path $root '.next\BUILD_ID'))){
  throw 'Antes de instalar ejecuta npm run build (con los servicios QA ya configurados).'
 }
 if(!(Test-Path (Join-Path $root '.local\supabase-qa\docker-compose.ops-qa.yml'))){
  throw 'No está configurado Docker/Supabase QA.'
 }
 if(!(Get-Command caddy -ErrorAction SilentlyContinue)){throw 'Falta Caddy en PATH del usuario Windows.'}
 if(!(Get-Command docker -ErrorAction SilentlyContinue)){throw 'Falta Docker Desktop.'}
}
function Get-TaskSafe{
 return Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
function Is-EntryAlive($entry){
 if(!$entry -or !$entry.id -or !$entry.startedUtcTicks){return $false}
 try{
  $p=Get-Process -Id ([int]$entry.id) -ErrorAction Stop
  return ($p.StartTime.ToUniversalTime().Ticks -eq [int64]$entry.startedUtcTicks)
 }catch{return $false}
}
function Stop-Descendants([int]$targetId){
 # El proceso registrado fue validado por PID + hora de creación antes de llamar.
 $children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$targetId) -ErrorAction SilentlyContinue)
 foreach($child in $children){Stop-Descendants ([int]$child.ProcessId)}
 Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue
}
function Stop-Safe{
 New-Item -ItemType Directory -Path $dir -Force | Out-Null
 Set-Content -LiteralPath $stopFile -Value 'stop requested' -Encoding Ascii
 $task=Get-TaskSafe
 if($task -and $task.State -eq 'Running'){
  Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
 }
 Start-Sleep -Seconds 2
 if(Test-Path $state){
  try{
   $data=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
   foreach($name in @('next','gateway')){
    $entry=$data.$name
    if(Is-EntryAlive $entry){Stop-Descendants ([int]$entry.id)}
   }
  }catch{
   Write-Warning 'No se pudieron inspeccionar todos los procesos registrados; revisar el estado.'
  }
  Remove-Item -LiteralPath $state -Force
 }
 Write-Host 'OPS QA detenido. Docker y su volumen de PostgreSQL permanecen intactos.' -ForegroundColor Yellow
}
switch($Action){
 'Install'{
  Assert-Qa
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $existing=Get-TaskSafe
  if($existing -and $existing.State -eq 'Running'){
   throw 'La tarea está corriendo. Detenerla antes de reinstalar.'
  }
  $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$runner+'"'
  $actionObj=New-ScheduledTaskAction -Execute "$PSHOME\powershell.exe" -Argument $arguments -WorkingDirectory $root
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
  $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $actionObj -Trigger $trigger -Settings $settings -Principal $principal -Description 'Cafe Epico OPS QA: backend LAN y HTTPS sin ventanas, sin cobros LIVE' -Force | Out-Null
  Write-Host 'PASS: tarea de inicio de sesión instalada, sin permisos de administrador.' -ForegroundColor Green
  Write-Host 'Docker Desktop: activa Start Docker Desktop when you sign in en su configuración.'
  Write-Host 'El agente de impresión tiene una tarea independiente; no fue alterado.'
  if($StartNow){
   Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
   Start-ScheduledTask -TaskName $taskName
   Write-Host 'Arranque solicitado. Revisar -Action Status en 2-3 minutos.'
  }
 }
 'Start'{
  Assert-Qa
  if(!(Get-TaskSafe)){throw 'Primero instala la tarea con -Action Install.'}
  Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $taskName
  Write-Host 'Arranque QA solicitado. Sin ventanas de PowerShell persistentes.' -ForegroundColor Green
 }
 'Status'{
  $task=Get-TaskSafe
  if(!$task){Write-Host 'No instalada. Ejecuta -Action Install.';break}
  Write-Host ('Tarea Windows: '+$task.State)
  $health=$false
  try{
   $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 4
   $health=$response.StatusCode -eq 200
  }catch{}
  Write-Host ('Next.js HTTP loopback: '+ $(if($health){'OK'}else{'SIN RESPUESTA'}))
  if(Test-Path $state){
   try{
    $obj=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    foreach($name in @('gateway','next')){
     $entry=$obj.$name
     Write-Host ($name+': '+$(if(Is-EntryAlive $entry){'EJECUTANDO'}else{'NO DETECTADO'}))
    }
   }catch{Write-Warning 'Archivo de estado no legible.'}
  }
  $log=Join-Path $dir 'supervisor.log'
  if(Test-Path $log){
   Write-Host 'Últimos mensajes QA:'
   Get-Content -LiteralPath $log -Tail 8
  }else{Write-Host 'Todavía no hay registro del supervisor.'}
  Write-Host 'Los logs privados están en .local\qa-runtime.'
 }
 'Stop'{Stop-Safe}
 'Uninstall'{
  Stop-Safe
  if(Get-TaskSafe){
   Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Write-Host 'Arranque automático QA desinstalado. Datos, Docker y agente de impresión intactos.'
 }
}
