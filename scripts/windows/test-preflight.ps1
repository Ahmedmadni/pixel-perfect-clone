#Requires -Version 5.1
<#
  Windows CI preflight tests: isolated throwaway configuration, no network
  access, no services, no user profile files and no secret exposure.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$root = Join-Path ([IO.Path]::GetTempPath()) ("paw-preflight-"+[Guid]::NewGuid().ToString("N"))
$testScript = Join-Path $PSScriptRoot "preflight.ps1"
$oldSmoke = $env:BROWSER_CI_TRUSTED_SMOKE
$env:BROWSER_CI_TRUSTED_SMOKE = $null
$passed = 0
function Put([string]$relative,[string]$content) {
  $path = Join-Path $root $relative
  $parent = Split-Path -Parent $path
  if(-not(Test-Path $parent)) {[IO.Directory]::CreateDirectory($parent) | Out-Null}
  [IO.File]::WriteAllText($path,$content,(New-Object Text.UTF8Encoding($false)))
}
function Check([string]$label,[bool]$shouldPass) {
  $didPass = $true
  try { & $testScript -Root $root | Out-Null }
  catch { $didPass = $false }
  if($didPass -ne $shouldPass) { throw "Preflight fixture failed: $label" }
  $script:passed++
  Write-Host ("PASS: "+$label)
}
$apiToken = "a"*64
$workerToken = "b"*64
$dbPass = "c"*40
$goodDatabase = "POSTGRES_PASSWORD=$dbPass" + [Environment]::NewLine
$goodRuntime = @"
RUNTIME_HOST=127.0.0.1
RUNTIME_PORT=4100
RUNTIME_TOKEN=$apiToken
BROWSER_WORKER_TOKEN=$workerToken
DATABASE_URL=postgres://paw:$dbPass@127.0.0.1:5432/paw
BROWSER_WORKER_URL=http://127.0.0.1:4300
OLLAMA_URL=http://127.0.0.1:11434
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
"@
$goodWorker = @"
BROWSER_WORKER_TOKEN=$workerToken
VNC_PASSWORD=abcdef01
BROWSER_AGENT_DOMAINS=
BROWSER_ENABLE_READONLY_AGENT=false
"@
$goodFrontend = @"
VITE_MOCK_MODE=false
VITE_LOCAL_API_URL=http://127.0.0.1:4100
VITE_NOVNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
"@
try {
  Put "local\.env" $goodDatabase
  Put "runtime\.env" $goodRuntime
  Put "browser-worker\.env" $goodWorker
  Put ".env.local" $goodFrontend
  Check "valid generated local settings" $true

  Put "runtime\.env" ($goodRuntime.Replace("BROWSER_WORKER_TOKEN=$workerToken","BROWSER_WORKER_TOKEN=" + ("f"*64)))
  Check "mismatched browser token fails closed" $false
  Put "runtime\.env" $goodRuntime

  Put "browser-worker\.env" ($goodWorker + [Environment]::NewLine + "BROWSER_CI_TRUSTED_SMOKE=true")
  Check "unsafe CI override is forbidden" $false
  Put "browser-worker\.env" $goodWorker

  Put "browser-worker\.env" ($goodWorker.Replace("BROWSER_ENABLE_READONLY_AGENT=false","BROWSER_ENABLE_READONLY_AGENT=true"))
  Check "user-selected tab does not require an extra global allowlist" $true
  Put "browser-worker\.env" $goodWorker

  Put "browser-worker\\.env" ($goodWorker.Replace("BROWSER_ENABLE_READONLY_AGENT=false","BROWSER_ENABLE_READONLY_AGENT=invalid"))
  Check "unknown agent permission flag forbidden" $false
  Put "browser-worker\\.env" $goodWorker

  Put ".env.local" ($goodFrontend.Replace("http://127.0.0.1:4100","https://remote.example:4100"))
  Check "remote API URL is forbidden" $false
  Put ".env.local" $goodFrontend

  Put "runtime\.env" ($goodRuntime.Replace("CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080","CORS_ORIGINS=https://remote.example"))
  Check "external CORS origin is forbidden" $false
  Put "runtime\.env" $goodRuntime

  Put "local\.env" "POSTGRES_PASSWORD=wrong_password"
  Check "database password mismatch is forbidden" $false
  Put "local\.env" $goodDatabase

  Remove-Item -LiteralPath (Join-Path $root "browser-worker\.env")
  Check "missing configuration is forbidden" $false
  Put "browser-worker\.env" $goodWorker

  $env:BROWSER_CI_TRUSTED_SMOKE = "true"
  Check "unsafe process-level CI override is forbidden" $false
  $env:BROWSER_CI_TRUSTED_SMOKE = $null
  Check "valid settings still pass" $true
  Write-Host "PASS: $passed isolated Windows preflight cases."
}
finally {
  $env:BROWSER_CI_TRUSTED_SMOKE = $oldSmoke
  if(Test-Path $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
