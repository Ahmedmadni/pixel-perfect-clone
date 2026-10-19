#Requires -Version 5.1
<#
  Read-only local launch preflight.
  Verifies config consistency BEFORE Docker or the API is started.
  Does not print secrets, modify files, probe accounts or contact any network.
  -Root exists for isolated, temporary fixtures in the Windows CI test.
#>
[CmdletBinding()]
param([string]$Root = "")

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
}

function Fail([string]$reason) { throw ("Local preflight blocked: " + $reason) }
function Read-Settings([string]$file) {
  if (-not [IO.File]::Exists($file)) { Fail "Missing a required local .env file. Run setup once; never paste secrets into chat." }
  $result = @{}
  foreach ($raw in [IO.File]::ReadAllLines($file)) {
    $line = $raw.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    $at = $line.IndexOf("=")
    if ($at -le 0) { Fail "Invalid settings file syntax." }
    $key = $line.Substring(0,$at).Trim()
    $value = $line.Substring($at+1).Trim()
    if ($result.ContainsKey($key)) { Fail "Duplicate setting name; fix the configuration locally." }
    $result[$key] = $value
  }
  return $result
}
function Need([System.Collections.IDictionary]$settings,[string]$name) {
  if (-not $settings.Contains($name) -or [string]::IsNullOrWhiteSpace($settings[$name])) {
    Fail "Missing required setting $name."
  }
  return [string]$settings[$name]
}
function Is-Loopback([string]$hostName) {
  return @("127.0.0.1","localhost","::1","[::1]") -ccontains $hostName
}
function Check-LocalUri([string]$value,[string]$label,[string]$protocol,[int]$port) {
  try { $uri = [Uri]::new($value) } catch { Fail "$label is not a valid local URL." }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -cne $protocol -or
      -not (Is-Loopback $uri.Host) -or $uri.Port -ne $port -or
      $uri.UserInfo -ne "" -or $uri.Fragment -ne "") {
    Fail "$label must use the expected loopback protocol and port."
  }
  return $uri
}
$database = Read-Settings (Join-Path $Root "local\.env")
$runtime = Read-Settings (Join-Path $Root "runtime\.env")
$worker = Read-Settings (Join-Path $Root "browser-worker\.env")
$frontend = Read-Settings (Join-Path $Root ".env.local")

$apiToken = Need $runtime "RUNTIME_TOKEN"
$runtimeWorkerToken = Need $runtime "BROWSER_WORKER_TOKEN"
$workerToken = Need $worker "BROWSER_WORKER_TOKEN"
$vncPassword = Need $worker "VNC_PASSWORD"
$dbPassword = Need $database "POSTGRES_PASSWORD"
if ($apiToken.Length -lt 32 -or $workerToken.Length -lt 32) {
  Fail "Local API/browser tokens are too short; regenerate them on your PC."
}
if ($runtimeWorkerToken -cne $workerToken) {
  Fail "Browser tokens in runtime and browser-worker do not match."
}
if ($apiToken -ceq $workerToken) {
  Fail "API and browser worker must use independent tokens."
}
if ($vncPassword.Length -lt 8) {
  Fail "The VNC password is too short."
}
if ((Need $runtime "RUNTIME_HOST") -cne "127.0.0.1" -or
    (Need $runtime "RUNTIME_PORT") -cne "4100") {
  Fail "Runtime must bind only to the expected local address and port."
}
$pg = Need $runtime "DATABASE_URL"
try {
  $pgUri = [Uri]::new($pg)
  $userPass = $pgUri.UserInfo.Split(@(":"),2,[StringSplitOptions]::None)
} catch { Fail "Invalid local PostgreSQL URL." }
if ($pgUri.Scheme -cne "postgres" -or $pgUri.Host -cne "127.0.0.1" -or
    $pgUri.Port -ne 5432 -or $pgUri.AbsolutePath -cne "/paw" -or
    $userPass.Length -ne 2 -or $userPass[0] -cne "paw" -or
    [Uri]::UnescapeDataString($userPass[1]) -cne $dbPassword) {
  Fail "PostgreSQL database URL does not match the local database credentials."
}
$api = Check-LocalUri (Need $frontend "VITE_LOCAL_API_URL") "UI API URL" "http" 4100
$browser = Check-LocalUri (Need $runtime "BROWSER_WORKER_URL") "Browser backend URL" "http" 4300
$ollama = Check-LocalUri (Need $runtime "OLLAMA_URL") "Ollama URL" "http" 11434
$novnc = Check-LocalUri (Need $frontend "VITE_NOVNC_URL") "noVNC URL" "http" 6080
if ($api.AbsolutePath -ne "/" -or $browser.AbsolutePath -ne "/" -or
    $ollama.AbsolutePath -ne "/" -or $novnc.AbsolutePath -cne "/vnc.html") {
  Fail "A local service URL contains an unexpected path."
}
if ((Need $frontend "VITE_MOCK_MODE") -cne "false") {
  Fail "The trusted local dashboard must use real mode, not mock mode."
}
$originList = (Need $runtime "CORS_ORIGINS").Split(",")
foreach ($entry in $originList) {
  $origin = $entry.Trim()
  try { $value = [Uri]::new($origin) }
  catch { Fail "Invalid CORS origin in local runtime settings." }
  if ($value.Scheme -cne "http" -or -not (Is-Loopback $value.Host) -or
      $value.Port -ne 8080 -or $value.AbsolutePath -ne "/" -or
      $value.UserInfo -ne "" -or $value.Query -ne "" -or $value.Fragment -ne "") {
    Fail "A CORS origin is not an approved local dashboard address."
  }
}
if ($worker.ContainsKey("BROWSER_CI_TRUSTED_SMOKE") -and
    $worker["BROWSER_CI_TRUSTED_SMOKE"].ToLowerInvariant() -eq "true") {
  Fail "Unsafe throwaway CI mode must never be enabled for a real profile."
}
if ($env:BROWSER_CI_TRUSTED_SMOKE -eq "true") {
  Fail "Unsafe CI mode is set in the process environment."
}
if ($worker.ContainsKey("BROWSER_ENABLE_READONLY_AGENT")) {
  $flag = $worker["BROWSER_ENABLE_READONLY_AGENT"].ToLowerInvariant()
  if (@("true","false") -cnotcontains $flag) {
    Fail "BROWSER_ENABLE_READONLY_AGENT must be true or false."
  }
}
# A user-selected tab is always scoped to its exact HTTPS origin by the worker.
# BROWSER_AGENT_DOMAINS is an optional, additional domain-level restriction.
Write-Host "[OK] Local secrets, service origins, worker handoff and production browser configuration are consistent." -ForegroundColor Green
Write-Host "[OK] This validation did not connect to websites, print tokens or modify any local file."
