#Requires -Version 5.1
<#
  One entry point for Windows: first run sets up, subsequent runs start.
  It never overwrites a partial configuration or an existing local secret.
  Requires Docker Desktop, Node 22+, npm, Bun; Ollama model installed separately.
#>
[CmdletBinding()]
param()
$ErrorActionPreference="Stop"
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$files=@(
  (Join-Path $root "local\.env"),
  (Join-Path $root "runtime\.env"),
  (Join-Path $root "browser-worker\.env"),
  (Join-Path $root ".env.local")
)
$present=@($files|Where-Object{Test-Path -LiteralPath $_})
if($present.Count -gt 0 -and $present.Count -lt $files.Count) {
  throw "Partial local settings found. Refusing to overwrite user secrets. See docs/WINDOWS_QUICKSTART.md for manual recovery."
}
if($present.Count -eq 0) {
  Write-Host "First launch: preparing private local browser and database configuration..."
  & (Join-Path $PSScriptRoot "setup.ps1")
  if($LASTEXITCODE -and $LASTEXITCODE -ne 0) {throw "Initial setup failed"}
}
Write-Host "Starting local Chromium browser and assistant..."
& (Join-Path $PSScriptRoot "start.ps1")
if($LASTEXITCODE -and $LASTEXITCODE -ne 0) {throw "Local startup failed"}
