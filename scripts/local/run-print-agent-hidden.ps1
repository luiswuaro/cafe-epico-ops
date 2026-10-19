#requires -Version 5.1
# Ejecutor de impresión QA sin consola visible. Sólo QA, sin tocar ventas reales.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
$guard=Join-Path $PSScriptRoot 'guard-qa-config.mjs'
$worker=Join-Path $PSScriptRoot 'print-agent.mjs'
$logDir=Join-Path $root '.local\qa-runtime'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$out=Join-Path $logDir 'print-agent.out.log'
$err=Join-Path $logDir 'print-agent.err.log'
$failure=Join-Path $logDir 'print-agent-launch.log'
try {
  if(!(Test-Path -LiteralPath $envFile -PathType Leaf)){throw 'No existe entorno QA.'}
  if(!(Test-Path -LiteralPath $worker -PathType Leaf)){throw 'No existe agente QA.'}
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  Push-Location $root
  try {
    & $node ("--env-file="+$envFile) $guard *> $null
    if($LASTEXITCODE -ne 0){throw 'El guard QA rechazó el entorno.'}
  }finally{Pop-Location}
  # Un archivo de log actual y uno anterior; sin mostrar secretos por consola.
  foreach($log in @($out,$err)){
    if(Test-Path -LiteralPath $log){
      Move-Item -LiteralPath $log -Destination ($log+'.previous') -Force
    }
  }
  $args='--env-file="'+$envFile+'" "'+$worker+'"'
  $child=Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -Wait -PassThru
  if($child.ExitCode -ne 0){throw 'El agente QA terminó con error; revisar logs privados.'}
  exit 0
}catch{
  Add-Content -LiteralPath $failure -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' Agente QA no iniciado o finalizado. Consultar logs privados.')
  exit 1
}
