#Requires -Version 5.1
<#
  Extremely sensitive offline Chromium-profile archiver.
  NEVER backs up/restores a running browser. Never overwrites the live Docker volume.
  Profile archives may contain live login cookies. Do NOT share them.
#>
[CmdletBinding(DefaultParameterSetName="Backup")]
param(
  [Parameter(Mandatory=$true,ParameterSetName="Backup")][switch]$Backup,
  [Parameter(Mandatory=$true,ParameterSetName="Verify")][switch]$Verify,
  [Parameter(Mandatory=$true,ParameterSetName="Restore")][switch]$Restore,
  [Parameter(ParameterSetName="Backup")][string]$OutputPath="",
  [Parameter(Mandatory=$true,ParameterSetName="Verify")]
  [Parameter(Mandatory=$true,ParameterSetName="Restore")][string]$InputPath
)
$ErrorActionPreference="Stop"
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw "Node.js 22+ is required"}
if(-not (Get-Command docker -ErrorAction SilentlyContinue)){throw "Docker is required"}
if($Backup -or $Restore) {
  Write-Warning "Chromium must be STOPPED completely first. This tool never interrupts the browser automatically."
  Write-Warning "An encrypted profile may include sensitive login cookies; never upload it to public GitHub/Lovable."
}
if(-not $Backup -and -not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Encrypted Chromium profile not found"
}
$secret=Read-Host "Chromium profile encryption passphrase (min 16 characters)" -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $pass=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if($pass.Length -lt 16){throw "Passphrase must contain at least 16 characters"}
  $operation=if($Backup){"backup"}elseif($Verify){"verify"}else{"restore"}
  $argsList=@("scripts/backup/browser-profile.mjs",$operation)
  if($Backup -and $OutputPath){$argsList+=@("--output",$OutputPath)}
  if(-not $Backup){$argsList+=@("--input",([IO.Path]::GetFullPath($InputPath)))}
  Push-Location $root
  try {
    $pass | & node @argsList
    if($LASTEXITCODE -ne 0) {throw "Chromium profile operation failed. Existing Docker profile was not modified."}
  } finally { Pop-Location }
} finally {
  $pass=$null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret.Dispose()
}
