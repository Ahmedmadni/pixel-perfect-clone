#Requires -Version 5.1
<# Isolated negative diagnostic regression; never reads the operator's configs. #>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = Join-Path ([IO.Path]::GetTempPath()) ("paw-diagnose-" + [Guid]::NewGuid().ToString("N"))
$script = Join-Path $PSScriptRoot "diagnose.ps1"
$privateMarker = "PRIVATE_TEST_TOKEN_NEVER_ECHO_" + [Guid]::NewGuid().ToString("N")
try {
  [IO.Directory]::CreateDirectory((Join-Path $root "runtime")) | Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $root "browser-worker")) | Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $root "local")) | Out-Null
  [IO.File]::WriteAllText((Join-Path $root "runtime\.env"), ("RUNTIME_TOKEN=" + $privateMarker + ("x" * 40)))
  [IO.File]::WriteAllText((Join-Path $root "browser-worker\.env"), "BROWSER_WORKER_TOKEN=")
  [IO.File]::WriteAllText((Join-Path $root "local\.env"), "POSTGRES_PASSWORD=test-only")
  [IO.File]::WriteAllText((Join-Path $root ".env.local"), "VITE_MOCK_MODE=false")
  # Run a separate PowerShell process: a strict diagnostic must exit with failure,
  # not accidentally terminate the parent test process.
  $shell = (Get-Process -Id $PID).Path
  $output = & $shell -NoProfile -File $script -Root $root -Strict 2>&1 | Out-String
  $status = $LASTEXITCODE
  if ($status -eq 0) { throw "Missing browser credentials incorrectly passed strict readiness." }
  if ($output -notmatch "Browser worker token:.*NOT READY|NOT READY.*Browser worker token") {
    # Diagnostic format is '[NOT READY] Browser worker token: ...'
    if ($output -notmatch "\[NOT READY\] Browser worker token") { throw "Missing browser token check was not reported." }
  }
  if ($output -notmatch "\[NOT READY\] Browser worker:") { throw "Worker authorization failure was not reported." }
  if ($output -match [regex]::Escape($privateMarker)) { throw "Sensitive test marker appeared in diagnostics." }
  Write-Host "PASS: strict mode fails on missing browser credential and does not expose configured runtime token."
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
