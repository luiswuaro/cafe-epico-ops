#requires -Version 5.1
# Sólo inicia Supabase QA ya configurado; bloquea cualquier puerto fuera de loopback.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stack=Join-Path $root '.local\supabase-qa'
if(!(Test-Path (Join-Path $stack 'docker-compose.yml'))){throw 'Ejecuta primero bootstrap-selfhost-qa.ps1'}
if(!(Test-Path (Join-Path $stack 'docker-compose.ops-qa.yml'))){throw 'Falta el override seguro de puertos.'}
if(!(Test-Path (Join-Path $root '.env.local'))){throw 'Falta .env.local de OPS QA.'}
if($env:DOCKER_HOST -or $env:DOCKER_CONTEXT){throw 'No usar Docker remoto.'}
$context=(& docker context show).Trim()
if($LASTEXITCODE -ne 0 -or $context -notin @('default','desktop-linux')){
  throw ('Contexto Docker no autorizado: '+$context)
}
Push-Location $root
try {
  & node ("--env-file="+(Join-Path $root '.env.local')) 'scripts/local/guard-qa-config.mjs'
  if($LASTEXITCODE -ne 0){throw 'BLOQUEADO: variables OPS apuntan a producción o no son QA locales.'}
  Push-Location $stack
  try {
    $compose=@('-f','docker-compose.yml','-f','docker-compose.ops-qa.yml')
    # Docker imprime secretos en el JSON: redirigir SOLAMENTE al validador local, no a la consola.
    $resolved = & docker compose @compose config --format json
    if($LASTEXITCODE -ne 0){throw 'Fallo al resolver docker compose.'}
    $resolved | & node (Join-Path $root 'scripts\local\inspect-qa-compose.mjs')
    if($LASTEXITCODE -ne 0){throw 'BLOQUEADO: algún servicio se publicaría en la LAN o internet.'}
    Write-Host 'Iniciando exclusivamente la réplica Supabase QA local.' -ForegroundColor Cyan
    & docker compose @compose up -d --wait
    if($LASTEXITCODE -ne 0){throw 'No se pudieron iniciar todos los servicios QA.'}
    Write-Host 'Supabase QA en loopback. Aún no ingresar ventas reales.' -ForegroundColor Green
  } finally {Pop-Location}
} finally {Pop-Location}
