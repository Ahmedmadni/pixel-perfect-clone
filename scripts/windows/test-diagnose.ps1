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
  # Run separate processes so intentional strict failures cannot terminate this test.
  $shell = (Get-Process -Id $PID).Path
  function Assert-NotReady([string]$label, [string[]]$requiredMarkers) {
    $output = & $shell -NoProfile -File $script -Root $root -Strict 2>&1 | Out-String
    $status = $LASTEXITCODE
    if ($status -eq 0) { throw "$label incorrectly passed strict readiness." }
    foreach ($marker in $requiredMarkers) {
      if ($output -notmatch [regex]::Escape($marker)) {
        throw "$label did not report the required failure: $marker"
      }
    }
    if ($output -match [regex]::Escape($privateMarker)) {
      throw "$label leaked a secret test marker."
    }
    Write-Host ("PASS: " + $label)
    $global:LASTEXITCODE = 0
  }
  Assert-NotReady "missing browser worker token" @("[NOT READY] Browser worker token:", "[NOT READY] Browser worker:")
  [IO.File]::WriteAllText((Join-Path $root "browser-worker\.env"), ("BROWSER_WORKER_TOKEN=" + $privateMarker + ("y" * 40)))
  [IO.File]::WriteAllText((Join-Path $root "runtime\.env"), "RUNTIME_TOKEN=")
  Assert-NotReady "missing runtime token" @("[NOT READY] Fastify token:", "[NOT READY] Fastify API:")
  [IO.File]::WriteAllText((Join-Path $root "runtime\.env"), ("RUNTIME_TOKEN=" + $privateMarker + ("x" * 40)))
  [IO.File]::WriteAllText((Join-Path $root "browser-worker\.env"), "BROWSER_WORKER_TOKEN=")
  Assert-NotReady "incomplete local authentication" @("[NOT READY] Browser worker token:", "Diagnostics finished:")
  # A child PowerShell deliberately failed. Clear its exit state so CI reports
  # the ASSERTIONS (rather than the child) as the test result.
  $global:LASTEXITCODE = 0
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
