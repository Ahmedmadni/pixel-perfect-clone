#Requires -Version 5.1
<#
  Run after setup.ps1. Starts local PostgreSQL and visible browser with Docker,
  applies SQL migrations and opens separate Fastify / UI development consoles.
  Never sets BROWSER_CI_TRUSTED_SMOKE: production Chromium sandbox is required.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$dbEnv = Join-Path $root "local\.env"
$runtimeEnv = Join-Path $root "runtime\.env"
$workerEnv = Join-Path $root "browser-worker\.env"
$frontEnv = Join-Path $root ".env.local"
foreach ($p in @($dbEnv,$runtimeEnv,$workerEnv,$frontEnv)) {
  if (-not (Test-Path $p)) { throw "Missing $p. Run scripts\windows\setup.ps1 first." }
}
# Check local settings and secrets BEFORE launching any Docker container.
& (Join-Path $PSScriptRoot "preflight.ps1")
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed." }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Bun is not installed." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Node/npm are not installed." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running. Start Docker Desktop/WSL2." }
$dockerOs = (& docker info --format "{{.OSType}}" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dockerOs -ne "linux") {
  throw "Docker must use Linux containers for Chromium/PostgreSQL. Switch Docker Desktop to Linux containers; do not disable Chromium sandbox."
}

$runtimeText = [System.IO.File]::ReadAllText($runtimeEnv)
$matchToken = [regex]::Match($runtimeText, "(?m)^BROWSER_WORKER_TOKEN=(.+)$")
if (-not $matchToken.Success -or $matchToken.Groups[1].Value.Trim().Length -lt 32) {
  throw "Browser worker token missing from runtime/.env."
}
$workerToken = $matchToken.Groups[1].Value.Trim()

Push-Location $root
try {
  Write-Host "Starting local PostgreSQL (database stays in a persistent Docker volume)..."
  & docker compose --env-file "local/.env" -f "compose.database.yml" up -d
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL container startup failed" }
  $dbReady = $false
  for($i=0;$i -lt 40;$i++){
    & docker compose --env-file "local/.env" -f "compose.database.yml" exec -T database pg_isready -U paw -d paw *> $null
    if ($LASTEXITCODE -eq 0) { $dbReady=$true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $dbReady) { throw "PostgreSQL did not become ready." }

  Write-Host "Starting local Chromium + noVNC; sandbox remains enabled..."
  & docker compose -f "compose.browser.yml" up -d --build
  if ($LASTEXITCODE -ne 0) { throw "Chromium/noVNC container startup failed." }
  $browserReady=$false
  for($i=0;$i -lt 30;$i++){
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:4300/health" -Headers @{Authorization=("Bearer "+$workerToken)} -TimeoutSec 4
      if ($health.ready -and $health.novnc -and $health.mode -eq "STOPPED") { $browserReady=$true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $browserReady) {
    Write-Warning "Browser could not start with Chromium sandbox. Do not disable security for real accounts."
    & docker compose -f "compose.browser.yml" logs --tail 50
    throw "Browser unavailable. See sandbox prerequisites in docs/LOCAL_SETUP.md."
  }

  Push-Location (Join-Path $root "runtime")
  try {
    & npm run migrate
    if ($LASTEXITCODE -ne 0) { throw "Database migrations failed." }
  } finally { Pop-Location }

  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Warning "Ollama not installed. The UI and browser can start, but real local chat will remain offline until you install Ollama."
  }
  $literal = $root.Replace("'", "''")
  $runtimeCommand = "Set-Location -LiteralPath '$literal\runtime'; npm run start"
  $frontendCommand = "Set-Location -LiteralPath '$literal'; bun run dev --host 127.0.0.1 --port 8080"
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-NoExit","-Command",$runtimeCommand) | Out-Null
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-NoExit","-Command",$frontendCommand) | Out-Null

  # Process creation is not proof of readiness: never open a misleading blank browser.
  $apiReady = $false
  $uiReady = $false
  for ($i=0; $i -lt 30; $i++) {
    if (-not $apiReady) {
      try {
        $state = Invoke-RestMethod -Uri "http://127.0.0.1:4100/v1/health" -TimeoutSec 3
        $db = @($state.services | Where-Object { $_.name -eq "postgres" -and $_.status -eq "up" })
        $apiReady = ($db.Count -gt 0)
      } catch {}
    }
    if (-not $uiReady) {
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/" -UseBasicParsing -TimeoutSec 3
        $uiReady = ($response.StatusCode -eq 200)
      } catch {}
    }
    if ($apiReady -and $uiReady) { break }
    Start-Sleep -Seconds 2
  }
  if (-not ($apiReady -and $uiReady)) {
    Write-Warning "One or more local processes did not become ready. Browser will not open automatically."
    Write-Host ("Fastify/PostgreSQL: " + $(if($apiReady){"ready"}else{"NOT READY"}))
    Write-Host ("Local dashboard: " + $(if($uiReady){"ready"}else{"NOT READY"}))
    Write-Host "Check the two opened PowerShell consoles, then run:"
    Write-Host "  .\\scripts\\windows\\diagnose.ps1"
    throw "Windows local startup did not pass readiness verification."
  }
  Write-Host "Trusted LOCAL dashboard ready; never paste secrets into hosted Lovable." -ForegroundColor Green
  Write-Host "Local UI: http://127.0.0.1:8080"
  Write-Host "Ollama model status is separate: check Settings or run diagnose.ps1 -TestInference."
  Write-Host "Use RUNTIME_TOKEN from runtime\\.env in Settings. noVNC has a separate password in browser-worker\\.env."
  Start-Process "http://127.0.0.1:8080" | Out-Null
} finally {
  Pop-Location
}
