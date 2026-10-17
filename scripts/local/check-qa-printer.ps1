#requires -Version 5.1
# Sólo GET /status loopback; NO imprime papel.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
if(!(Test-Path $envFile)){throw 'Falta .env.local QA.'}
function Read-QAEnv([string]$key){
 $line=Get-Content -LiteralPath $envFile | Where-Object {
   $_ -match ('^'+[regex]::Escape($key)+'\s*=')
 } | Select-Object -Last 1
 if(!$line){return ''}
 return (($line -split '=',2)[1].Trim().Trim('"').Trim("'"))
}
$null=Get-Command node -ErrorAction Stop
& node ("--env-file="+$envFile) (Join-Path $PSScriptRoot 'guard-qa-config.mjs')
if($LASTEXITCODE -ne 0){throw 'BLOQUEADO: entorno no QA local.'}
$stations=@(
 @{Name='Ticket';Port=(Read-QAEnv 'OPS_LOCAL_TICKET_PRINTER_PORT');
   Token=(Read-QAEnv 'OPS_LOCAL_TICKET_PRINTER_TOKEN')},
 @{Name='Barra';Port=(Read-QAEnv 'OPS_LOCAL_KITCHEN_PRINTER_PORT');
   Token=(Read-QAEnv 'OPS_LOCAL_KITCHEN_PRINTER_TOKEN')}
)
$checked=0
foreach($station in $stations){
 $portText=[string]$station.Port
 if(!$portText){if($station.Name -eq 'Ticket'){$portText='9137'}else{continue}}
 $port=0
 if(![int]::TryParse($portText,[ref]$port) -or $port -lt 1024 -or $port -gt 65535){
   throw ('Puerto inválido para '+$station.Name)
 }
 if(!$station.Token -or $station.Token.Contains('REEMPLAZAR')){
   Write-Host ($station.Name+': token QA no definido.') -ForegroundColor Yellow
   continue
 }
 try{
   $headers=@{'X-Cafe-Epico-Token'=[string]$station.Token}
   $uri='http://127.0.0.1:'+ $port+'/status'
   $result=Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 4
   if($result.ok -ne $true -or $result.mode -ne 'RAW_ESC_POS'){
     throw 'Respuesta no compatible'
   }
   Write-Host ($station.Name+': PASS. Puerto '+$port+' · '+$result.mode+
     ' · version '+$result.version+'. NO se imprimio papel.') -ForegroundColor Green
   $checked++
 }catch{
   Write-Host ($station.Name+': BLOQUEADO. Verifica puente, token local y puerto.') -ForegroundColor Yellow
 }
}
if($checked -lt 1){throw 'Ningún puente de impresora QA respondió.'}
Write-Host ('Puentes locales activos: '+$checked+'. Prueba física pendiente.')
