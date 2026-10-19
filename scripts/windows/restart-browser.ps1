#Requires -Version 5.1
<#
  Restart only the project's local Chromium worker, keeping its Docker volume.
  No database operations, no deletion, no sandbox bypass, and no agent resume.
  This is a maintenance command: do not use it during an active task.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$envPath = Join-Path $root "browser-worker\.env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Local browser settings missing; no container changes made."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker not found; no container changes made."
}
function Read-EnvValue([string]$file,[string]$key) {
  foreach($line in [IO.File]::ReadAllLines($file)) {
    if($line.StartsWith($key+"=")) { return $line.Substring($key.Length+1).Trim() }
  }
  return ""
}
$token = Read-EnvValue $envPath "BROWSER_WORKER_TOKEN"
if($token.Length -lt 32) { throw "Browser token missing or invalid; no container changes made." }
# Prevent accidental use of the temporary CI bypass on a real browser profile.
if($env:BROWSER_CI_TRUSTED_SMOKE -eq "true" -or (Read-EnvValue $envPath "BROWSER_CI_TRUSTED_SMOKE") -eq "true") {
  throw "Unsafe CI browser mode is forbidden on a local user profile."
}
& docker info *> $null
if($LASTEXITCODE -ne 0) { throw "Docker Engine is not running; no changes made." }
$dockerOs = (& docker info --format "{{.OSType}}" 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $dockerOs -ne "linux") { throw "Docker must use Linux containers; no changes made." }
# Refuse to interrupt a live owner/agent handoff. An unavailable worker is
# not evidence of an idle browser, so recovery must be handled separately.
try {
  $before = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 5
} catch {
  throw "Cannot verify browser ownership before restart; no containers changed."
}
if(-not $before.ready -or $before.mode -ne "STOPPED") {
  throw "Browser must already be STOPPED before maintenance restart. Stop the active task through the trusted local UI first."
}
Push-Location $root
try {
  & docker compose -f "compose.browser.yml" stop browser-worker
  if($LASTEXITCODE -ne 0) { throw "Browser stop failed; startup was not attempted." }
  & docker compose -f "compose.browser.yml" up -d --no-deps browser-worker
  if($LASTEXITCODE -ne 0) { throw "Browser restart failed; inspect local container logs." }
  $ready = $false
  for($i=0; $i -lt 30; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 4
      if($health.ready -and $health.novnc -and $health.mode -eq "STOPPED") { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if(-not $ready) {
    throw "Browser did not return to STOPPED/read-only readiness. Do not disable Chromium sandbox or use real accounts."
  }
  Write-Host "[OK] Browser restarted in STOPPED mode. Database and persisted profile were not replaced." -ForegroundColor Green
  Write-Host "Agent remains inactive; regain manual control from the trusted local UI."
} finally {
  Pop-Location
}
