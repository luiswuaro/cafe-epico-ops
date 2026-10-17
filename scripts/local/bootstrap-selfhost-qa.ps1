#requires -Version 5.1
# Descarga UNA COPIA AISLADA de Supabase self-hosted. No la arranca ni crea datos reales.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$local=Join-Path $root '.local'
$source=Join-Path $local 'supabase-source'
$stack=Join-Path $local 'supabase-qa'
$version='self-hosted/v0.8.2'

if(Test-Path $stack){throw 'Ya existe .local/supabase-qa. No se sobrescribe una instalación existente.'}
if(Test-Path $source){throw 'Ya existe .local/supabase-source. Revisar manualmente antes de continuar.'}
$null=Get-Command git -ErrorAction Stop
$null=Get-Command docker -ErrorAction Stop
$null=Get-Command node -ErrorAction Stop
if($env:DOCKER_HOST -or $env:DOCKER_CONTEXT){
  throw 'Desactiva DOCKER_HOST y DOCKER_CONTEXT: no utilizar contenedores remotos.'
}
$context=(& docker context show).Trim()
if($LASTEXITCODE -ne 0 -or $context -notin @('default','desktop-linux')){
  throw ('Contexto Docker no autorizado para la PC local: '+$context)
}
$dc=(& docker compose version --short).Trim().TrimStart('v')
if($LASTEXITCODE -ne 0){throw 'Docker Compose no disponible.'}
$match=[regex]::Match($dc,'^(\d+)\.(\d+)\.(\d+)')
if(!$match.Success){throw 'No se pudo comprobar la versión de Docker Compose.'}
$major=[int]$match.Groups[1].Value
$minor=[int]$match.Groups[2].Value
$patch=[int]$match.Groups[3].Value
if($major -lt 2 -or ($major -eq 2 -and $minor -lt 24) -or ($major -eq 2 -and $minor -eq 24 -and $patch -lt 4)){
  throw 'Se necesita Docker Compose 2.24.4+ para reemplazar puertos con !override.'
}
New-Item -ItemType Directory -Path $local -Force | Out-Null
Write-Host ('Descargando sólo el directorio docker del release '+$version) -ForegroundColor Cyan
& git clone --quiet --filter=blob:none --no-checkout --depth=1 --branch $version https://github.com/supabase/supabase $source
if($LASTEXITCODE -ne 0){throw 'Fallo git clone. No se arrancó ningún servicio.'}
& git -C $source sparse-checkout init --cone
if($LASTEXITCODE -ne 0){throw 'Fallo sparse-checkout.'}
& git -C $source sparse-checkout set docker
if($LASTEXITCODE -ne 0){throw 'Fallo sparse-checkout set.'}
& git -C $source checkout --quiet
if($LASTEXITCODE -ne 0){throw 'Fallo git checkout.'}
Copy-Item -LiteralPath (Join-Path $source 'docker') -Destination $stack -Recurse -Force
if(!(Test-Path (Join-Path $stack '.env.example'))){throw 'No se encontró la plantilla oficial de Supabase.'}
Copy-Item -LiteralPath (Join-Path $stack '.env.example') -Destination (Join-Path $stack '.env')
Copy-Item -LiteralPath (Join-Path $root 'infra\local\docker-compose.ops-qa.yml') -Destination (Join-Path $stack 'docker-compose.ops-qa.yml')
Set-Content -LiteralPath (Join-Path $stack '.supabase-version') -Value ("ref="+$version) -Encoding Ascii
Write-Host 'Pila QA preparada SIN ARRANCAR. No se han generado claves ni creado usuarios.' -ForegroundColor Green
Write-Host 'Sigue docs/operations/selfhost-qa-bootstrap.md para generar secretos y verificar HTTPS antes de usar celulares.'
