#requires -Version 5.1
# Vincula SOLO la credencial del puente POS-58 existente a .env.local de QA.
# Sin impresión, sin instalación, sin reinicio y sin modificar el puente comercial.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath=Join-Path $root '.env.local'
$bridgePath=Join-Path (Join-Path $env:LOCALAPPDATA 'CafeEpicoOps') 'print-bridge.json'
$guard=Join-Path $PSScriptRoot 'guard-qa-config.mjs'
$tmp=$null

Push-Location $root
try {
  if (!(Test-Path -LiteralPath $envPath -PathType Leaf)) {throw 'No existe .env.local QA.'}
  & git check-ignore -q -- '.env.local'
  if ($LASTEXITCODE -ne 0) {throw 'BLOQUEADO: .env.local no está ignorado por Git.'}
  & node ("--env-file="+$envPath) $guard
  if ($LASTEXITCODE -ne 0) {throw 'BLOQUEADO: la configuración no es QA local.'}

  $all=[IO.File]::ReadAllText($envPath)
  if ($all -match '(?m)^\\s*NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED\\s*=\\s*["'']?true') {
    throw 'BLOQUEADO: apaga primero el modo de agente QA.'
  }
  if (Get-ScheduledTask -TaskName 'CafeEpicoOps-QA-PrintAgent' -ErrorAction SilentlyContinue |
      Where-Object {$_.State -eq 'Running'}) {
    throw 'BLOQUEADO: tarea de agente QA ya está ejecutándose.'
  }
  $active=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {$_.CommandLine -like '*scripts/local/print-agent.mjs*'})
  if ($active.Count -gt 0) {throw 'BLOQUEADO: hay un agente QA en ejecución.'}

  if (!(Test-Path -LiteralPath $bridgePath -PathType Leaf)) {
    throw 'No se encontró el puente instalado para Tickets.'
  }
  $cfg=Get-Content -LiteralPath $bridgePath -Raw | ConvertFrom-Json
  $printer=[string]$cfg.printerName
  $port=[int]$cfg.port
  $token=[string]$cfg.token
  if ($printer -ne 'POS-58 (copy 1)' -or $port -ne 9137 -or
      $token -notmatch '^[0-9a-fA-F-]{32,}$') {
    throw 'Configuración del puente distinta de la POS-58 validada. Sin cambios.'
  }

  # Solicitud GET autenticada. NUNCA se llama /print ni se revela el token.
  $status=Invoke-RestMethod -Method Get -TimeoutSec 4 -Uri 'http://127.0.0.1:9137/status' -Headers @{
    'X-Cafe-Epico-Token'=$token
  }
  if ($status.ok -ne $true -or $status.mode -ne 'RAW_ESC_POS' -or
      [string]$status.printer -ne $printer) {
    throw 'El puente no confirma identidad/protocolo de la POS-58 esperada.'
  }

  $lines=[Collections.Generic.List[string]]::new()
  foreach($line in ($all -split "\r?\n")) { [void]$lines.Add($line) }
  foreach($entry in @(
    @{key='OPS_LOCAL_TICKET_PRINTER_TOKEN';value=$token},
    @{key='OPS_LOCAL_TICKET_PRINTER_PORT';value='9137'}
  )) {
    $key=[string]$entry.key
    $value=[string]$entry.value
    $hits=@(0..($lines.Count-1) | Where-Object { $lines[$_] -match ('^\\s*'+[regex]::Escape($key)+'\\s*=') })
    if ($hits.Count -gt 1) {throw "BLOQUEADO: variable duplicada: $key"}
    if ($hits.Count -eq 1) {
      $index=[int]$hits[0]
      $existing=(($lines[$index] -split '=',2)[1]).Trim().Trim('"').Trim("'")
      if ($key -eq 'OPS_LOCAL_TICKET_PRINTER_TOKEN' -and
          $existing -and $existing -notmatch '(?i)^(REEMPLAZAR|CHANGE_ME|TOKEN_DEL_PUENTE)' -and
          $existing -ne $value) {
        throw 'BLOQUEADO: ya existe otro token de Tickets en QA. Revisar manualmente.'
      }
      $lines[$index]="$key=$value"
    } else {
      [void]$lines.Add("$key=$value")
    }
  }

  $updated=$lines -join "`r`n"
  $tmp=$envPath+'.link-'+[guid]::NewGuid().ToString('N')+'.tmp'
  [IO.File]::WriteAllText($tmp,$updated,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::Replace($tmp,$envPath,$null)
  $tmp=$null
  Write-Host 'PASS: enlace privado de Ticket a POS-58 / 9137 guardado únicamente en .env.local QA.' -ForegroundColor Green
  Write-Host 'PASS: puente autenticado mediante GET /status. No se imprimió papel.' -ForegroundColor Green
  Write-Host 'Sin iniciar agentes ni enviar comandas. Barra separada todavía no configurada.' -ForegroundColor Yellow
} finally {
  if ($tmp -and (Test-Path -LiteralPath $tmp)) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
