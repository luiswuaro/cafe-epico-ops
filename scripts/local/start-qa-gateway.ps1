#requires -Version 5.1
# Caddy TLS local QA: escucha SOLO en la IP privada asignada a la PC.
# No instala certificados en otros equipos ni cambia el firewall.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
$config=Join-Path $root 'infra\local\Caddyfile.example'
if(!(Test-Path $envFile)){throw 'Falta .env.local QA.'}
$null=Get-Command caddy -ErrorAction Stop
$null=Get-Command node -ErrorAction Stop
Push-Location $root
try{
  & node ("--env-file="+$envFile) 'scripts/local/guard-qa-config.mjs'
  if($LASTEXITCODE -ne 0){throw 'Configuración QA bloqueada por el guard de seguridad.'}
  $originLine=Get-Content -LiteralPath $envFile |
    Where-Object {$_ -match '^APP_ORIGIN\s*='} | Select-Object -Last 1
  if(!$originLine){throw 'No se definió APP_ORIGIN en .env.local.'}
  $url=($originLine -split '=',2)[1].Trim().Trim('"').Trim("'")
  $origin=[uri]$url
  if($origin.Scheme -ne 'https' -or $origin.Port -ne 8443){
    throw 'APP_ORIGIN debe ser https://IP_PRIVADA_PC:8443 para Caddy QA.'
  }
  $parsedIp=[System.Net.IPAddress]::None
  if(![System.Net.IPAddress]::TryParse($origin.Host,[ref]$parsedIp) -or
      $parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork){
    throw 'APP_ORIGIN QA debe emplear una IP privada IPv4 explícita.'
  }
  $assigned=Get-NetIPAddress -AddressFamily IPv4 -IPAddress $origin.Host -ErrorAction SilentlyContinue
  if(!$assigned){throw 'La IP del certificado HTTPS no está asignada a ninguna interfaz activa de esta PC.'}
  if(!$($assigned | Where-Object {$_.AddressState -eq 'Preferred'})){
    throw 'La IP asignada a la PC no está lista para escuchar conexiones.'
  }
  $env:OPS_LAN_HOST=$origin.Host
  try{
    & caddy validate --config $config --adapter caddyfile
    if($LASTEXITCODE -ne 0){throw 'El Caddyfile QA no pasó validación.'}
    Write-Host ('Gateway HTTPS QA vinculado sólo a '+$origin.Host+':8443') -ForegroundColor Cyan
    Write-Host 'Los móviles necesitan la CA de Caddy instalada en su almacén de confianza.' -ForegroundColor Yellow
    & caddy run --config $config --adapter caddyfile
    if($LASTEXITCODE -ne 0){throw 'Caddy finalizó con error.'}
  }finally{Remove-Item Env:OPS_LAN_HOST -ErrorAction SilentlyContinue}
}finally{Pop-Location}
