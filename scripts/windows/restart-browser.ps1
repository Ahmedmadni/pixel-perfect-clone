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
# Require the named project service to be running before trusting localhost health.
# An unrelated service bound to port 4300 must never authorize maintenance.
Push-Location $root
try {
  $initialServices = @(& docker compose -f "compose.browser.yml" ps --status running --services 2>$null)
  if($LASTEXITCODE -ne 0 -or -not ($initialServices -contains "browser-worker")) {
    throw "Managed browser service is not running; no containers changed."
  }
} finally {
  Pop-Location
}
# Refuse to interrupt a live owner/agent handoff. An unavailable worker is
# not evidence of an idle browser, so recovery must be handled separately.
try {
  $before = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 5
} catch {
  throw "Cannot verify browser ownership before restart; no containers changed."
}
if(-not $before.ready -or -not $before.novnc -or -not $before.viewOnly -or $before.mode -ne "STOPPED") {
  throw "Browser must already be STOPPED before maintenance restart. Stop the active task through the trusted local UI first."
}
$composePath = Join-Path $root "compose.browser.yml"
if (-not (Test-Path -LiteralPath $composePath)) { throw "Browser compose definition missing; no containers changed." }
Push-Location $root
try {
  & docker compose -f "compose.browser.yml" config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Browser compose configuration invalid; no containers changed." }
  # Recheck ownership immediately before the first state-changing operation.
  # The earlier health check may have become stale while validating compose.
  try {
    $current = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 5
  } catch {
    throw "Browser ownership changed or became unreachable; no containers changed."
  }
  if(-not $current.ready -or -not $current.novnc -or -not $current.viewOnly -or $current.mode -ne "STOPPED") {
    throw "Browser is no longer STOPPED/view-only; no containers changed."
  }
  # Ask the worker to stay STOPPED; a status probe alone is not a lock.
  # A concurrent owner handoff may still race, so this is defense in depth.
  try {
    $freeze = Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:4300/maintenance/lock" -Headers @{Authorization=("Bearer "+$token)} -ContentType "application/json" -Body '{}' -TimeoutSec 5
  } catch {
    throw "Cannot confirm STOPPED handoff; no containers changed."
  }
  if($freeze.mode -ne "STOPPED" -or -not $freeze.viewOnly -or $freeze.maintenanceLocked -ne $true) {
    throw "STOPPED handoff failed; no containers changed."
  }
  & docker compose -f "compose.browser.yml" stop -t 30 browser-worker
  if($LASTEXITCODE -ne 0) { throw "Browser stop failed; startup was not attempted." }
  & docker compose -f "compose.browser.yml" up -d --no-deps browser-worker
  if($LASTEXITCODE -ne 0) { throw "Browser restart failed; inspect local container logs." }
  $ready = $false
  for($i=0; $i -lt 30; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 4
      if($health.ready -and $health.novnc -and $health.viewOnly -and $health.mode -eq "STOPPED" -and $health.maintenanceLocked -eq $false) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if(-not $ready) {
    throw "Browser did not return to STOPPED/read-only readiness. Do not disable Chromium sandbox or use real accounts."
  }
  # A successful health probe must also belong to the managed Docker service.
  # Do not report success if another local process answered on port 4300.
  $runningServices = @(& docker compose -f "compose.browser.yml" ps --status running --services 2>$null)
  if($LASTEXITCODE -ne 0 -or -not ($runningServices -contains "browser-worker")) {
    throw "Browser compose service is not running; restart cannot be certified."
  }
  # A last authenticated health read after verifying Docker service state
  # guards against stale readiness while the service was being inspected.
  try {
    $finalHealth = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$token)} -TimeoutSec 5
  } catch {
    throw "Browser health became unreachable after Docker verification; restart cannot be certified."
  }
  if(-not $finalHealth.ready -or -not $finalHealth.novnc -or -not $finalHealth.viewOnly -or
      $finalHealth.mode -ne "STOPPED" -or $finalHealth.maintenanceLocked -ne $false) {
    throw "Browser health changed after Docker verification; restart cannot be certified."
  }
  Write-Host "[OK] Browser restarted in STOPPED mode. Database and persisted profile were not replaced." -ForegroundColor Green
  Write-Host "Agent remains inactive; regain manual control from the trusted local UI."
} finally {
  Pop-Location
}
