#requires -Version 5.1
<#
  Bootstrap para el ZIP autónomo de OPS Guardian V1.
  Solo añade archivos nuevos a la carpeta LIVE; nunca sustituye
  un archivo local distinto sin revisión del propietario.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Join-Path $env:USERPROFILE 'Documents\GitHub\cafe-epico-ops-live'
$manifestPath = Join-Path $PSScriptRoot 'ARCHIVOS_SHA256.txt'
$files = @(
  'scripts/local/print-guardian-core.mjs',
  'scripts/local/print-guardian-core.test.mjs',
  'scripts/local/print-guardian-health.mjs',
  'scripts/local/validate-live-guardian.mjs',
  'scripts/local/Instalar-OPS-Guardian.ps1',
  'scripts/local/Corregir-Inicio-OPS-LIVE.ps1',
  'docs/operations/guardian-print-live.md'
)

if (!(Test-Path -LiteralPath $manifestPath)) { throw 'ZIP incompleto: falta manifest.' }
if (!(Test-Path -LiteralPath (Join-Path $repo '.env.local'))) {
  throw 'No encuentro cafe-epico-ops-live con su .env.local. No se copiaron archivos.'
}
if (!(Test-Path -LiteralPath (Join-Path $repo 'scripts\local\print-agent.mjs'))) {
  throw 'No encuentro el agente LIVE original. No se copiaron archivos.'
}

$expected = @{}
foreach ($line in Get-Content -LiteralPath $manifestPath) {
  if ($line -match '^([0-9a-fA-F]{64})\s{2}(.+)$') {
    $expected[$Matches[2]] = $Matches[1].ToLowerInvariant()
  }
}

foreach ($file in $files) {
  $relative = $file.Replace('/', '\')
  $source = Join-Path $PSScriptRoot ('files\' + $relative)
  $target = Join-Path $repo $relative
  if (!(Test-Path -LiteralPath $source)) { throw ('ZIP incompleto: ' + $file) }
  $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  if (!$expected.ContainsKey($file) -or $actual -ne $expected[$file]) {
    throw ('Hash incorrecto; no instalar: ' + $file)
  }
  if (Test-Path -LiteralPath $target) {
    $current = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($current -ne $actual) {
      throw ('El archivo local tiene cambios: ' + $file + '. No se sobrescribe.')
    }
  }
}

Write-Host 'GUARDIAN: HASHES Y ARCHIVOS LOCALES VALIDADOS' -ForegroundColor Green
$newFiles = @()
try {
  foreach ($file in $files) {
    $relative = $file.Replace('/', '\')
    $source = Join-Path $PSScriptRoot ('files\' + $relative)
    $target = Join-Path $repo $relative
    if (!(Test-Path -LiteralPath $target)) {
      $parent = Split-Path -Parent $target
      if (!(Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }
      Copy-Item -LiteralPath $source -Destination $target -ErrorAction Stop
      $newFiles += $target
    }
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  Push-Location -LiteralPath $repo
  try {
    & $node 'scripts/local/validate-live-guardian.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Fallo revisión estática Guardian.' }
    & $node '--test' 'scripts/local/print-guardian-core.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas unitarias Guardian.' }
  } finally { Pop-Location }

  & (Join-Path $repo 'scripts\local\Instalar-OPS-Guardian.ps1')
  if (!$?) { throw 'El instalador Guardian devolvió error.' }
  # El Guardian ya quedo instalado: una incidencia con la tarea de navegador
  # no debe deshacer sus archivos ni desactivar su recuperacion de impresion.
  try {
    & (Join-Path $repo 'scripts\local\Corregir-Inicio-OPS-LIVE.ps1') -Apply
    if (!$?) { throw 'La auditoria de inicio Windows devolvio error.' }
  } catch {
    Write-Warning ('Guardian instalado. El inicio de Chrome requiere revision: ' + $_.Exception.Message)
  }
  Write-Host 'GUARDIAN: INSTALACION TERMINADA' -ForegroundColor Green
} catch {
  # Solo se retiran archivos que este bootstrap acaba de crear.
  foreach ($path in $newFiles) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
  }
  throw
}
