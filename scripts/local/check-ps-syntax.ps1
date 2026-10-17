# PowerShell parser check for CI. Never runs the checked scripts.
$ErrorActionPreference = 'Stop'
$files = @(
  'scripts/local/test-lan.ps1',
  'scripts/local/check-windows.ps1',
  'scripts/local/start-qa.ps1',
  'scripts/local/bootstrap-selfhost-qa.ps1',
  'scripts/local/start-selfhost-qa.ps1',
  'scripts/local/start-qa-gateway.ps1',
  'tools/print-bridge/Instalar-EstacionOPS.ps1',
  'scripts/local/install-print-agent.ps1'
)
foreach($file in $files){
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path (Get-Location).Path $file),
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if($errors -and $errors.Count -gt 0){
    foreach($err in $errors){Write-Error ($file+': '+$err.Message)}
    exit 1
  }
  Write-Host ('POWERSHELL SYNTAX PASS: '+$file)
}
