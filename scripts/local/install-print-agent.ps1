#requires -Version 5.1
# Registra worker QA al iniciar sesión. No modifica impresoras ni POS comercial.
[CmdletBinding()]
param([switch]$Uninstall,[switch]$StartNow)
Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"
$task="CafeEpicoOps-QA-PrintAgent"
if($Uninstall){
  $existing=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if($existing){
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
  }
  Write-Host "Agente QA desregistrado. Tokens e impresoras sin cambios."
  exit 0
}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile=Join-Path $root '.env.local'
$worker=Join-Path $root 'scripts\local\print-agent.mjs'
$guard=Join-Path $root 'scripts\local\guard-qa-config.mjs'
if(!(Test-Path -LiteralPath $envFile -PathType Leaf)){throw 'Falta .env.local local QA.'}
if(!(Test-Path -LiteralPath $worker -PathType Leaf)){throw 'Falta agente de impresión.'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
& $node ("--env-file="+$envFile) $guard
if($LASTEXITCODE -ne 0){throw 'No instalar: el entorno no cumple seguridad QA.'}
# Nunca escribir tokens en línea de comandos ni logs.
$arguments='--env-file="'+$envFile+'" "'+$worker+'"'
$current=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
if($current -and $current.State -eq 'Running'){
  throw 'El agente ya está activo. Detenerlo antes de reinstalar.'
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Café Épico OPS: agente QA de impresión sin navegador' -Force | Out-Null
Write-Host "Agente QA registrado. Sin cambios a producción." -ForegroundColor Green
if($StartNow){
  Start-ScheduledTask -TaskName $task
  Write-Host "Agente QA iniciado. Validar estado del puente y la tarea."
}else{
  Write-Host "Para iniciar durante QA, ejecutar -StartNow."
}
