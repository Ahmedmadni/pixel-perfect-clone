#Requires -Version 5.1
<#
  Local read-only diagnostics. Does not change state, tokens, browser control,
  database, permissions, sessions or user profiles. Never prints secrets.
#>
[CmdletBinding()]
param([switch]$TestInference, [switch]$Strict, [string]$Root = "")
$ErrorActionPreference = "Stop"
$script:checksFailed = 0
$root = if ([string]::IsNullOrWhiteSpace($Root)) { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..")) } else { [System.IO.Path]::GetFullPath($Root) }
$runtimeConfig = Join-Path $root "runtime\.env"
$browserConfig = Join-Path $root "browser-worker\.env"
function Check([string]$name, [bool]$ok, [string]$detail) {
  if (-not $ok) { $script:checksFailed += 1 }
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
Check "Docker Engine" $engine "Docker daemon reachable"
if ($engine) {
  $dockerOs = (& docker info --format "{{.OSType}}" 2>$null | Out-String).Trim()
  Check "Docker Linux containers" ($LASTEXITCODE -eq 0 -and $dockerOs -eq "linux") "Linux container mode required for Chromium and PostgreSQL"
} else {
  Check "Docker Linux containers" $false "cannot check container mode without Docker Engine"
}
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
    Check "Fastify API" ([bool]$h.services) "local health endpoint reachable with service details"
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
  Check "Fastify API" $false "cannot verify authenticated local API without configured token"
}
Check "Browser worker token" ($workerToken.Length -ge 32) "browser-worker/.env token present"
if($workerToken.Length -ge 32) {
  try {
    $h=Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$workerToken)} -TimeoutSec 6
    Check "Chromium" ([bool]$h.ready) "worker reports actual browser context"
    Check "noVNC socket" ([bool]$h.novnc) "local WebSocket listener"
    Write-Host ("Browser owner mode: "+$h.mode)
    Write-Host ("Browser tabs: "+$h.tabs)
    if ($null -ne $h.maintenanceLocked) {
      $lockConsistent = -not [bool]$h.maintenanceLocked -or ($h.mode -eq "STOPPED" -and [bool]$h.viewOnly)
      Check "Maintenance lock safety" $lockConsistent "locked worker must remain STOPPED and view-only"
      if ([bool]$h.maintenanceLocked) {
        Write-Host "Maintenance lock: active (restart only after the current maintenance operation completes)"
      } else {
        Write-Host "Maintenance lock: inactive"
      }
    } else {
      Check "Maintenance lock status" $false "worker health response does not expose maintenanceLocked"
    }
  } catch {
    Check "Browser worker" $false "local worker is offline or not authenticated"
  }
} else {
  Check "Browser worker" $false "cannot verify local worker without configured token"
}
try {
  $models=Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
  $installed = @($models.models)
  Check "Real Ollama" ($installed.Count -gt 0) ("installed models: "+$installed.Count)
  if($TestInference -and $installed.Count -gt 0) {
    $chosen = $installed[0].name
    Write-Host "Testing one short REAL local Ollama inference (this can take time on CPU)..."
    try {
      $request = @{
        model = $chosen
        stream = $false
        messages = @(@{role = "user";content = "اكتب كلمة واحدة بالعربية: مرحبا"})
        options = @{num_predict = 24}
      } | ConvertTo-Json -Depth 5
      $answer=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:11434/api/chat" -ContentType "application/json" -Body $request -TimeoutSec 120
      Check "Ollama inference" ([bool]$answer.done -and [bool]$answer.message.content) ("model response received locally; content not printed")
    } catch {
      Check "Ollama inference" $false "model timed out, failed to load, or did not finish"
    }
  }
} catch {
  Check "Real Ollama" $false "not running; install Ollama and pull a supported model"
}
Write-Host "No account content, session cookies, access tokens, or private backup data were printed."
Write-Host ("Diagnostics finished: " + $script:checksFailed + " check(s) not ready.")
if ($Strict -and $script:checksFailed -gt 0) {
  Write-Error "Local workspace is not fully ready. Inspect statuses above; no secrets were printed."
  exit 1
}

