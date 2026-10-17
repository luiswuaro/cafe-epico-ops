#requires -Version 5.1
# Sólo inicia NEXT.JS en loopback tras comprobar la configuración QA LOCAL.
# No habilita producción, no abre puertos LAN y no expone HTTPS directamente.
[CmdletBinding()]
param([switch]$SkipBuild)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
$guard=Join-Path $root 'scripts\local\guard-qa-config.mjs'
if(!(Test-Path $envFile)){throw 'Falta .env.local. Usa .env.local-first.example SOLO con las credenciales de la réplica local.'}

Push-Location $root
try{
  $node=Get-Command node -ErrorAction Stop
  $version=(& node --version).Trim()
  if([int]([regex]::Match($version,'\d+').Value) -lt 22){
    throw ('Se necesita Node.js 22+: actual '+$version)
  }
  & node ("--env-file="+$envFile) $guard
  if($LASTEXITCODE -ne 0){throw 'BLOQUEADO: configuración NO local o no QA. No se inició Next.js.'}

  if(!$SkipBuild){
    Write-Host 'Compilando Next.js local, solo para QA ...'
    & npm run build
    if($LASTEXITCODE -ne 0){throw 'Compilación local falló. No se inició el servidor.'}
  }
  Write-Host 'Prueba Next.js SOLO en 127.0.0.1:3000. Los móviles requieren configurar HTTPS con proxy antes de acceso LAN.' -ForegroundColor Yellow
  & npm run start -- --hostname 127.0.0.1 --port 3000
  if($LASTEXITCODE -ne 0){throw ('Next.js terminó con error '+$LASTEXITCODE)}
}finally{
  Pop-Location
}
