#requires -Version 5.1
# Cambia solo el puerto host de transacciones Supavisor QA, sin borrar datos.
[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$HostPort=16543)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stack=Join-Path $root '.local\supabase-qa'
$override=Join-Path $stack 'docker-compose.ops-qa.yml'
$envFile=Join-Path $root '.env.local'
if(!(Test-Path -LiteralPath (Join-Path $stack '.supabase-version'))){
  throw 'No se reconoce la pila autoalojada QA. Reparacion cancelada.'
}
if(!(Test-Path -LiteralPath $override) -or !(Test-Path -LiteralPath $envFile)){
  throw 'Faltan override o credenciales locales QA.'
}
if($HostPort -in @(3000,5432,8000,8443,9137,9138)){
  throw 'Puerto reservado por OPS local. Elige otro.'
}
Push-Location $root
try{
  & node ("--env-file="+$envFile) 'scripts/local/guard-qa-config.mjs'
  if($LASTEXITCODE -ne 0){throw 'Bloqueado: no es entorno QA local.'}
  $listener=[System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Parse('127.0.0.1'),$HostPort)
  try{
    $listener.Start()
  }catch{
    throw ('Puerto alternativo '+$HostPort+' ocupado o reservado. No se cambio nada.')
  }finally{
    $listener.Stop()
  }
  $original=[System.IO.File]::ReadAllText($override)
  $old='127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION:-6543}:6543/tcp'
  $fixed='127.0.0.1:${OPS_QA_TRANSACTION_HOST_PORT:-16543}:6543/tcp'
  $replacement='127.0.0.1:'+$HostPort+':6543/tcp'
  if($original.Contains($replacement)){
    Write-Host ('Override QA ya utiliza '+$HostPort+'.') -ForegroundColor Green
    $updated=$original
  }elseif($original.Contains($old)){
    $updated=$original.Replace($old,$replacement)
  }elseif($original.Contains($fixed)){
    $updated=$original.Replace($fixed,$replacement)
  }else{
    throw 'Override distinto del archivo QA previsto; no se modifica a ciegas.'
  }
  if($updated -ne $original){
    [System.IO.File]::WriteAllText($override,$updated,(New-Object System.Text.UTF8Encoding($false)))
  }
  try{
    Push-Location $stack
    try{
      $resolved=& docker compose -f docker-compose.yml -f docker-compose.ops-qa.yml config --format json
      if($LASTEXITCODE -ne 0){throw 'Docker Compose no pudo resolver el override QA.'}
      $resolved | & node (Join-Path $root 'scripts\local\inspect-qa-compose.mjs')
      if($LASTEXITCODE -ne 0){throw 'Compose inseguro o servicio obligatorio ausente.'}
    }finally{Pop-Location}
  }catch{
    if($updated -ne $original){
      [System.IO.File]::WriteAllText($override,$original,(New-Object System.Text.UTF8Encoding($false)))
    }
    throw 'Validacion de Compose fallo; se restauro el override previo.'
  }
  Write-Host ('PASS: Supavisor QA solo publica transacciones en 127.0.0.1:'+$HostPort) -ForegroundColor Green
  Write-Host 'Puerto 5432 de OPS sin cambios. No se borraron bases ni contenedores.'
  Write-Host 'Ahora puedes reintentar start-selfhost-qa.ps1.'
}finally{Pop-Location}
