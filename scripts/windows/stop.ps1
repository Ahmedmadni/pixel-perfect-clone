#Requires -Version 5.1
<#
  Non-destructive local shutdown. Stops only this project's Docker services.
  Preserves PostgreSQL and Chromium persistent volumes, local .env files,
  and all encrypted backups. Close the separately opened API/UI consoles.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker not found; no changes made."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "local\.env"))) {
  throw "Missing local database config; no containers changed."
}
Push-Location $root
try {
  # No 'down', '--volumes', '-v', pruning or removal options.
  & docker compose -f "compose.browser.yml" stop -t 30 browser-worker
  if ($LASTEXITCODE -ne 0) { throw "Browser worker did not stop cleanly; database was left untouched." }
  & docker compose --env-file "local/.env" -f "compose.database.yml" stop -t 30 database
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL container did not stop cleanly." }
  Write-Host "Docker browser and database stopped. Persistent volumes and secrets remain unchanged." -ForegroundColor Green
  Write-Host "Close the separate Fastify/UI PowerShell windows if they are still open."
} finally {
  Pop-Location
}
