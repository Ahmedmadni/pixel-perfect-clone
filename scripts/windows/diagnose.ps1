#Requires -Version 5.1
<#
  Local read-only diagnostics. Does not change state, tokens, browser control,
  database, permissions, sessions or user profiles. Never prints secrets.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$runtimeConfig = Join-Path $root "runtime\.env"
$browserConfig = Join-Path $root "browser-worker\.env"
function Check([string]$name, [bool]$ok, [string]$detail) {
  $state = if ($ok) { "OK" } else { "NOT READY" }
  Write-Host ("[{0}] {1}: {2}" -f $state,$name,$detail)
}
function Read-EnvValue([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return "" }
  foreach ($line in [System.IO.File]::ReadAllLines($path)) {
    if ($line.StartsWith($key+"=")) { return $line.Substring($key.Length+1).Trim() }
  }
  return ""
}
Check "Local runtime config" (Test-Path $runtimeConfig) "runtime/.env"
Check "Browser worker config" (Test-Path $browserConfig) "browser-worker/.env"
Check "Frontend config" (Test-Path (Join-Path $root ".env.local")) ".env.local"
Check "Postgres config" (Test-Path (Join-Path $root "local\.env")) "local/.env"
foreach ($name in @("node","npm","bun","docker")) {
  Check "Program $name" ([bool](Get-Command $name -ErrorAction SilentlyContinue)) "installed in PATH"
}
$engine = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  & docker info *> $null
  $engine = $LASTEXITCODE -eq 0
}
Check "Docker Engine" $engine "running with local Linux container support"
if($engine -and (Test-Path (Join-Path $root "local\.env"))) {
  Push-Location $root
  try {
    & docker compose --env-file "local/.env" -f "compose.database.yml" exec -T database pg_isready -U paw -d paw *> $null
    Check "PostgreSQL" ($LASTEXITCODE -eq 0) "local container reachable (credentials not displayed)"
  } catch {
    Check "PostgreSQL" $false "container not running or unavailable"
  } finally { Pop-Location }
}
$runtimeToken = Read-EnvValue $runtimeConfig "RUNTIME_TOKEN"
$workerToken = Read-EnvValue $browserConfig "BROWSER_WORKER_TOKEN"
if($runtimeToken.Length -ge 32) {
  try {
    $h=Invoke-RestMethod -Uri "http://127.0.0.1:4100/v1/health" -TimeoutSec 6
    foreach($service in $h.services) {
      Check ("Fastify: "+$service.name) ($service.status -eq "up") ("status "+$service.status)
    }
    $control=Invoke-RestMethod -Uri "http://127.0.0.1:4100/v1/agent/status" -Headers @{Authorization=("Bearer "+$runtimeToken)} -TimeoutSec 5
    Write-Host ("Control state: "+$control.control)
  } catch {
    Check "Fastify API" $false "local service is not responding or token was not accepted"
  }
} else {
  Check "Fastify token" $false "runtime/.env token missing or invalid"
}
if($workerToken.Length -ge 32) {
  try {
    $h=Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$workerToken)} -TimeoutSec 6
    Check "Chromium" ([bool]$h.ready) "worker reports actual browser context"
    Check "noVNC socket" ([bool]$h.novnc) "local WebSocket listener"
    Write-Host ("Browser owner mode: "+$h.mode)
    Write-Host ("Browser tabs: "+$h.tabs)
  } catch {
    Check "Browser worker" $false "local worker is offline or not authenticated"
  }
}
try {
  $models=Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
  Check "Real Ollama" ($null -ne $models.models -and @($models.models).Count -gt 0) (
    "installed models: "+@($models.models).Count
  )
} catch {
  Check "Real Ollama" $false "not running; install Ollama and pull a supported model"
}
Write-Host "No account content, session cookies, access tokens, or private backup data were printed."
