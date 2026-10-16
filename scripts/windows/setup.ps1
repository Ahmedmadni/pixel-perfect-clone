#Requires -Version 5.1
<#
  First-time Windows setup. Generates strong per-service secrets locally.
  This script will never overwrite existing configuration files.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
function Need-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name was not found. Install it first; see docs/LOCAL_SETUP.md."
  }
}
function New-RandomHex([int]$numBytes) {
  $bytes = New-Object byte[] $numBytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}
function Write-PrivateFile([string]$path, [string]$value) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path,$value,$utf8)
}
function Replace-Env([string]$value, [string]$name, [string]$replacement) {
  $pattern = "(?m)^" + [regex]::Escape($name) + "=.*$"
  if (-not [regex]::IsMatch($value, $pattern)) { throw "Missing $name in .env.example" }
  return [regex]::Replace($value, $pattern, ($name+"="+$replacement))
}
Need-Command "docker"
Need-Command "node"
Need-Command "npm"
Need-Command "bun"
$localDir = Join-Path $root "local"
$databaseEnv = Join-Path $localDir ".env"
$runtimeEnv = Join-Path $root "runtime\.env"
$browserEnv = Join-Path $root "browser-worker\.env"
$frontendEnv = Join-Path $root ".env.local"
foreach ($item in @($databaseEnv,$runtimeEnv,$browserEnv,$frontendEnv)) {
  if (Test-Path $item) {
    throw "Existing local configuration found: $item. Setup stops to avoid overwriting secrets."
  }
}
if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Path $localDir | Out-Null }
$dbPass = New-RandomHex 20
$runtimeToken = New-RandomHex 32
$workerToken = New-RandomHex 32
# Legacy VNC uses only the first eight ASCII password characters;
# noVNC and VNC bind to loopback, never the public internet.
$vncPass = New-RandomHex 4
$runtimeTemplate = [System.IO.File]::ReadAllText((Join-Path $root "runtime\.env.example"))
$runtimeTemplate = Replace-Env $runtimeTemplate "RUNTIME_TOKEN" $runtimeToken
$runtimeTemplate = Replace-Env $runtimeTemplate "DATABASE_URL" ("postgres://paw:"+$dbPass+"@127.0.0.1:5432/paw")
$runtimeTemplate = Replace-Env $runtimeTemplate "BROWSER_WORKER_TOKEN" $workerToken
$workerTemplate = [System.IO.File]::ReadAllText((Join-Path $root "browser-worker\.env.example"))
$workerTemplate = Replace-Env $workerTemplate "BROWSER_WORKER_TOKEN" $workerToken
$workerTemplate = Replace-Env $workerTemplate "VNC_PASSWORD" $vncPass
$frontendTemplate = @"
VITE_MOCK_MODE=false
VITE_LOCAL_API_URL=http://127.0.0.1:4100
VITE_NOVNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
"@
Write-PrivateFile $databaseEnv ("POSTGRES_PASSWORD="+$dbPass+[Environment]::NewLine)
Write-PrivateFile $runtimeEnv $runtimeTemplate
Write-PrivateFile $browserEnv $workerTemplate
Write-PrivateFile $frontendEnv $frontendTemplate
Write-Host "Local secrets and application configuration created." -ForegroundColor Green
Write-Host "Installing project dependencies..."
Push-Location $root
try {
  & bun install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed" }
  Push-Location (Join-Path $root "runtime")
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "Runtime dependency installation failed" }
  } finally { Pop-Location }
} finally { Pop-Location }
Write-Host "Setup ready. Run scripts\windows\start.ps1 to start local services." -ForegroundColor Green
Write-Host "Find your local RUNTIME_TOKEN in runtime\.env and enter it in Settings. Never share it."
Write-Host "Install free Ollama separately and pull a model, e.g. ollama pull llama3.2."
