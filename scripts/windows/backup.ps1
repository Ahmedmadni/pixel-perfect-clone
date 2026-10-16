#Requires -Version 5.1
<#
  Encrypted local PostgreSQL backup. Prompts for a passphrase without echo.
  NEVER supply the passphrase on a command line or store it in a .env file.
#>
[CmdletBinding()]
param([string]$OutputPath="")
$ErrorActionPreference="Stop"
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if(-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22+ is required" }
if(-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required" }
$first=Read-Host "Backup password (at least 16 characters; keep it safe)" -AsSecureString
$again=Read-Host "Confirm backup password" -AsSecureString
function Unprotect([Security.SecureString]$value) {
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$pass=Unprotect $first
$passAgain=Unprotect $again
try {
  if($pass.Length -lt 16) { throw "Backup password must contain at least 16 characters" }
  if($pass -cne $passAgain) { throw "Backup password confirmation did not match" }
  $arguments=@("scripts/backup/db-backup.mjs","backup")
  if($OutputPath) { $arguments+=@("--output",$OutputPath) }
  Push-Location $root
  try {
    # The password goes to Node via stdin only. Never echoed in console arguments.
    $pass | & node @arguments
    if($LASTEXITCODE -ne 0) { throw "Encrypted backup failed. Your existing database was not changed." }
  } finally { Pop-Location }
} finally {
  $pass=$null; $passAgain=$null
  $first.Dispose(); $again.Dispose()
}
