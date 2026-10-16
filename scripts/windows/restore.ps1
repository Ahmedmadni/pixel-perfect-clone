#Requires -Version 5.1
<#
  Verify/decrypt an encrypted .pawbak archive and restore into a NEW PostgreSQL
  database. Never overwrites the primary paw database.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [string]$NewDatabase=""
)
$ErrorActionPreference="Stop"
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if(-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22+ is required" }
if(-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required" }
if(-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Encrypted backup file was not found" }
Write-Host "Restore creates an isolated database. The existing paw database will NOT be overwritten."
$first=Read-Host "Enter the backup password (hidden)" -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
try {
  $pass=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if($pass.Length -lt 16) { throw "Backup password must contain at least 16 characters" }
  $arguments=@("scripts/backup/db-backup.mjs","restore","--input",([System.IO.Path]::GetFullPath($InputPath)))
  if($NewDatabase) { $arguments+=@("--database",$NewDatabase) }
  Push-Location $root
  try {
    $pass | & node @arguments
    if($LASTEXITCODE -ne 0) { throw "Restore failed. Primary paw database was not changed." }
  } finally { Pop-Location }
} finally {
  $pass=$null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $first.Dispose()
}
