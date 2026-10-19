#requires -Version 5.1
# Supervisor QA oculto. NO habilita ventas LIVE ni abre PostgreSQL a la LAN.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$local=Join-Path $root '.local\qa-runtime'
$statePath=Join-Path $local 'services.json'
$stopFile=Join-Path $local 'stop.request'
$envFile=Join-Path $root '.env.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
function Log([string]$message){
 $logPath=Join-Path $local 'supervisor.log'
 if((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 2097152){
   Move-Item -LiteralPath $logPath -Destination (Join-Path $local 'supervisor.previous.log') -Force
 }
 Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' '+$message)
}
function Get-Entry([string]$name){
 if(!(Test-Path $statePath)){return $null}
 try {
  $value=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  return $value.$name
 }catch{return $null}
}
function Is-OwnedAlive($entry){
 if(!$entry -or !$entry.id -or !$entry.startedUtcTicks){return $false}
 try{
   $p=Get-Process -Id ([int]$entry.id) -ErrorAction Stop
   return ($p.StartTime.ToUniversalTime().Ticks -eq [int64]$entry.startedUtcTicks)
 }catch{return $false}
}
function Save-State(){
 @{gateway=$script:gateway; next=$script:nextApp} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
}
function Guard(){
 if(!(Test-Path -LiteralPath $envFile -PathType Leaf)){throw 'Falta .env.local QA'}
 & node ("--env-file="+$envFile) 'scripts/local/guard-qa-config.mjs' *> $null
 if($LASTEXITCODE -ne 0){throw 'Guard QA rechazó el entorno. Sin arranque.'}
 if(!(Test-Path -LiteralPath (Join-Path $root '.next\BUILD_ID'))){
   throw 'Falta compilación .next/BUILD_ID. Ejecutar npm run build antes de instalar.'
 }
}
function Listener([int]$port){
 return [bool]@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}
function Start-Hidden([string]$name,[string]$script,[switch]$skipBuild){
 $out=Join-Path $local ($name+'.out.log')
 $err=Join-Path $local ($name+'.err.log')
 $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$script+'"'
 if($skipBuild){$args+=' -SkipBuild'}
 $proc=Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
 return @{id=$proc.Id;startedUtcTicks=$proc.StartTime.ToUniversalTime().Ticks}
}
function Test-Api(){
 try{
  $res=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 5 -UseBasicParsing
  return $res.StatusCode -eq 200
 }catch{return $false}
}
Push-Location $root
try{
 $mutex=[System.Threading.Mutex]::new($false,'Local\CafeEpicoOpsQaRuntimeSupervisor')
 if(!$mutex.WaitOne(0)){Log 'Otra instancia supervisa OPS QA. Salida limpia.';exit 0}
 try{
  if(Test-Path $stopFile){Remove-Item -LiteralPath $stopFile -Force}
  $script:gateway=Get-Entry 'gateway'
  $script:nextApp=Get-Entry 'next'
  $script:databaseReady=$false
  Log 'Supervisor QA iniciado; sin ventanas y sin cobros LIVE.'
  $lastError=''
  while(!(Test-Path $stopFile)){
   try{
    Guard
    & docker info --format '{{.ServerVersion}}' *> $null
    if($LASTEXITCODE -ne 0){throw 'Docker Desktop no está listo. Reintento automático.'}
    if(!$script:databaseReady){
     $startup=Join-Path $PSScriptRoot 'start-selfhost-qa.ps1'
     & "$PSHOME\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $startup *>> (Join-Path $local 'database-start.log')
     if($LASTEXITCODE -ne 0){throw 'Docker QA no inició correctamente; ver database-start.log.'}
     $script:databaseReady=$true
     Log 'PostgreSQL/Auth QA arrancaron en loopback.'
    }
    if(!(Is-OwnedAlive $script:gateway)){
     if(Listener 8443){throw 'Puerto 8443 ocupado por otro proceso; no se duplica Caddy.'}
     $script:gateway=Start-Hidden 'caddy' (Join-Path $PSScriptRoot 'start-qa-gateway.ps1')
     Save-State
     Log ('Caddy QA iniciado, PID '+$script:gateway.id)
    }
    if(!(Is-OwnedAlive $script:nextApp)){
     if(Listener 3000){throw 'Puerto 3000 ocupado por otro proceso; no se duplica Next.js.'}
     $script:nextApp=Start-Hidden 'next' (Join-Path $PSScriptRoot 'start-qa.ps1') -skipBuild
     Save-State
     Log ('Next.js QA iniciado, PID '+$script:nextApp.id)
    }
    if(Test-Api){
     if($lastError){Log 'HTTP QA recuperado.'}
     $lastError=''
    }elseif(!$lastError){
     Log 'Esperando health 127.0.0.1:3000; revisar next.err.log si persiste.'
    }
   }catch{
    $msg=$_.Exception.Message
    if($msg -match 'postgresql?:|password|TOKEN|SECRET|DATABASE_URL='){$msg='Error de entorno; revisar logs privados.'}
    if($lastError -ne $msg){Log ('PENDIENTE: '+$msg);$lastError=$msg}
    if($msg -like '*Docker*'){$script:databaseReady=$false}
   }
   Start-Sleep -Seconds 20
  }
  Log 'Parada solicitada.'
 }finally{
  try{$mutex.ReleaseMutex()}catch{}
  $mutex.Dispose()
 }
}finally{Pop-Location}
