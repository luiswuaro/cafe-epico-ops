#requires -Version 5.1
# Arranque QA aislado. Sin ventas reales ni cambios a producción.
[CmdletBinding()]
param(
 [ValidateSet("Doctor","Start")][string]$Mode="Doctor",
 [switch]$WithPrinter
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
Push-Location $root
try{
 Write-Host '=== CAFÉ ÉPICO LOCAL / SOLO QA ===' -ForegroundColor Cyan
 & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-windows.ps1')
 $preflightExit=$LASTEXITCODE
 if($Mode -eq 'Doctor'){
   if($preflightExit -ne 0){
     Write-Host 'Diagnostico terminado con REQUISITOS PENDIENTES. No iniciar servidores todavia.' -ForegroundColor Yellow
     exit $preflightExit
   }
   Write-Host 'Herramientas detectadas; falta configurar QA para poder iniciar servicios.' -ForegroundColor Green
   Write-Host 'Para iniciar: .\scripts\local\launch-qa.ps1 -Mode Start'
   exit 0
 }
 if($preflightExit -ne 0){
   throw 'No se iniciara QA: faltan herramientas o Docker Engine no funciona.'
 }
 if(!(Test-Path $envFile)){throw 'No existe .env.local QA; nunca copiar secretos comerciales.'}
 $node=(Get-Command node -ErrorAction Stop).Source
 & $node ("--env-file="+$envFile) 'scripts/local/guard-qa-config.mjs'
 if($LASTEXITCODE -ne 0){throw 'BLOQUEADO: entorno no local QA.'}
 $stack=Join-Path $root '.local\supabase-qa'
 if(!(Test-Path (Join-Path $stack 'docker-compose.yml'))){
   throw 'Falta Supabase QA. Ejecuta bootstrap-selfhost-qa.ps1 y configura secretos.'
 }
 & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-selfhost-qa.ps1')
 if($LASTEXITCODE -ne 0){throw 'Postgres y Auth QA no están listos.'}
 & $node ("--env-file="+$envFile) 'scripts/local/apply-qa-schema.mjs' '--seed-qa'
 if($LASTEXITCODE -ne 0){throw 'Migraciones QA fallaron. No iniciar Next.'}
 & $node ("--env-file="+$envFile) 'scripts/local/seed-qa-operations.mjs'
 if($LASTEXITCODE -ne 0){throw 'Checklists QA no están listos.'}
 $gateway=Join-Path $PSScriptRoot 'start-qa-gateway.ps1'
 $gatewayArgs='-NoExit -NoProfile -ExecutionPolicy Bypass -File "'+$gateway+'"'
 Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList $gatewayArgs | Out-Null
 $caLine=Get-Content -LiteralPath $envFile | Where-Object {$_ -match '^OPS_LOCAL_CA_FILE\s*='} | Select-Object -Last 1
 if(!$caLine){throw 'Caddy arrancó; falta OPS_LOCAL_CA_FILE en .env.local'}
 $ca=($caLine -split '=',2)[1].Trim().Trim('"').Trim("'")
 $ready=$false
 for($i=0;$i -lt 30;$i++){
   if(Test-Path -LiteralPath $ca -PathType Leaf){$ready=$true;break}
   Start-Sleep -Seconds 2
 }
 if(!$ready){throw 'CA de Caddy no disponible en 60 s. Revisa la ventana de Caddy.'}
 $next=Join-Path $PSScriptRoot 'start-qa.ps1'
 $nextArgs='-NoExit -NoProfile -ExecutionPolicy Bypass -File "'+$next+'"'
 Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList $nextArgs | Out-Null
 Write-Host 'Next.js QA: nueva ventana, espera a que termine la compilación.' -ForegroundColor Yellow
 if($WithPrinter){
   $enabled=Get-Content -LiteralPath $envFile | Where-Object {$_ -match '^NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED\s*=\s*true\s*$'}
   if(!$enabled){throw 'Impresión QA no habilitada explícitamente en .env.local.'}
   $worker=Join-Path $PSScriptRoot 'print-agent.mjs'
   $args='-NoExit -NoProfile -ExecutionPolicy Bypass -Command "node --env-file=.env.local '+$worker+'"'
   Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList $args | Out-Null
   Write-Host 'Agente QA lanzado. Verifica la impresora ANTES de generar comandas.' -ForegroundColor Yellow
 }
 Write-Host 'Al terminar el arranque: node --env-file=.env.local scripts/local/qa-smoke.mjs'
 Write-Host 'Sólo datos ficticios. No apagar POS comercial.' -ForegroundColor Green
}finally{Pop-Location}
