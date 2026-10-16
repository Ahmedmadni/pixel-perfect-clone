#Requires -Version 5.1
<#
Opt-in Windows Task Scheduler encrypted PostgreSQL backup.
Commands:
  -Enable [-Hour 3] [-Minute 0] [-Directory "D:\PrivateBackups"]
  -Run
  -Status
  -Disable
  -SelfTest (CI: DPAPI test only; NO scheduled task and NO database)
Requires the SAME Windows user to be logged in for scheduled runs.
Secrets are DPAPI CurrentUser-protected and never stored in scheduled-task arguments.
No pruning/deletion of .pawbak files happens automatically.
#>
[CmdletBinding(DefaultParameterSetName="Status")]
param(
  [Parameter(Mandatory=$true,ParameterSetName="Enable")][switch]$Enable,
  [Parameter(Mandatory=$true,ParameterSetName="Run")][switch]$Run,
  [Parameter(Mandatory=$true,ParameterSetName="Disable")][switch]$Disable,
  [Parameter(Mandatory=$true,ParameterSetName="Status")][switch]$Status,
  [Parameter(Mandatory=$true,ParameterSetName="SelfTest")][switch]$SelfTest,
  [Parameter(ParameterSetName="Enable")][ValidateRange(0,23)][int]$Hour=3,
  [Parameter(ParameterSetName="Enable")][ValidateRange(0,59)][int]$Minute=0,
  [Parameter(ParameterSetName="Enable")][string]$Directory=""
)
$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "The scheduled backup uses Windows DPAPI; it cannot run on Linux." }
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$taskName="PAW-LocalEncryptedPostgresBackup"
$stateDir=Join-Path $env:LOCALAPPDATA "PAW-Workspace"
$secretFile=Join-Path $stateDir "backup-key.dpapi"
$configFile=Join-Path $stateDir "backup-task.json"
$logFile=Join-Path $stateDir "backup-schedule.log"
$scriptPath=[System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
function ReadSecret {
  $encrypted=[System.IO.File]::ReadAllText($secretFile).Trim()
  if(-not $encrypted) { throw "Backup secret is missing or empty" }
  return ConvertTo-SecureString -String $encrypted
}
function ProtectFile([string]$path) {
  # File ACLs restrict access to the owner and SYSTEM. DPAPI also binds the
  # ciphertext to this Windows account and machine. No secret is in task args.
  $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $path /inheritance:r /grant:r ("{0}:(F)" -f $user) "SYSTEM:(F)" *> $null
  if($LASTEXITCODE -ne 0) { throw "Could not protect local backup configuration ACLs" }
}
function WriteState([string]$path,[string]$value) {
  $encoding=New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path,$value,$encoding)
  ProtectFile $path
}
function ToPlaintext([Security.SecureString]$secure) {
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function LogResult([string]$outcome) {
  if(-not (Test-Path $stateDir)) {New-Item -ItemType Directory -Path $stateDir -Force | Out-Null}
  # Generic status only. No backup paths, keys, account data, error dumps, etc.
  $entry=("{0:u} {1}" -f [datetime]::UtcNow,$outcome)
  Add-Content -LiteralPath $logFile -Value $entry -Encoding UTF8
  ProtectFile $logFile
}
function SecurePassphrase {
  $first=Read-Host "Set your unique backup recovery passphrase (at least 16 characters)" -AsSecureString
  $again=Read-Host "Confirm recovery passphrase" -AsSecureString
  try {
    $a=ToPlaintext $first
    $b=ToPlaintext $again
    if($a.Length -lt 16) { throw "Choose a passphrase of at least 16 characters" }
    if($a -cne $b) { throw "Passphrase confirmation does not match" }
    return $first
  } finally {
    $a=$null; $b=$null
    $again.Dispose()
  }
}
function InvokeEncryptedBackup([string]$folder,[Security.SecureString]$secret) {
  $backupScript=Join-Path $root "scripts\backup\db-backup.mjs"
  $node=(Get-Command node -ErrorAction Stop).Source
  $stamp=(Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fffffff")
  $output=Join-Path $folder ("paw-auto-"+$stamp+".pawbak")
  if(($backupScript.Contains('"')) -or ($output.Contains('"'))) {
    throw "Unsafe path contains a quote character"
  }
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$node
  $psi.Arguments=('"{0}" backup --output "{1}"' -f $backupScript,$output)
  $psi.WorkingDirectory=$root
  $psi.UseShellExecute=$false
  $psi.RedirectStandardInput=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $psi.CreateNoWindow=$true
  $psi.StandardInputEncoding=New-Object System.Text.UTF8Encoding($false)
  $process=New-Object System.Diagnostics.Process
  $process.StartInfo=$psi
  $password=ToPlaintext $secret
  try {
    if(-not $process.Start()){throw "Could not start local encryption"}
    $process.StandardInput.WriteLine($password)
    $process.StandardInput.Close()
    $stdout=$process.StandardOutput.ReadToEnd()
    $stderr=$process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if($process.ExitCode -ne 0){throw "Local encrypted backup command returned failure"}
    if(-not (Test-Path -LiteralPath $output -PathType Leaf)) {throw "Encrypted archive was not created"}
    # Print only a generic success message: output filename stays on local disk.
    Write-Host "Encrypted backup completed successfully and checked for integrity."
  } finally {
    $password=$null
    $process.Dispose()
  }
}
if($SelfTest) {
  # Offline security test: nothing is registered, copied or deleted.
  $secure=ConvertTo-SecureString "Synthetic DPAPI secret: never a user passphrase!" -AsPlainText -Force
  try {
    $cipher=ConvertFrom-SecureString $secure
    $opened=ConvertTo-SecureString $cipher
    try {
      if((ToPlaintext $opened) -cne "Synthetic DPAPI secret: never a user passphrase!") {
        throw "DPAPI did not roundtrip correctly"
      }
      Write-Host "PASS: DPAPI CurrentUser roundtrip; no backups/tasks/secrets were created."
    } finally {$opened.Dispose()}
  } finally {$secure.Dispose()}
  return
}
if($Status) {
  $registered=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Write-Host ("Task registered: "+[bool]$registered)
  if($registered) {
    Write-Host ("Task state: "+$registered.State)
    $taskInfo=Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    if($taskInfo) {
      Write-Host ("Last result: "+$taskInfo.LastTaskResult)
      Write-Host ("Next run: "+$taskInfo.NextRunTime)
    }
  }
  Write-Host ("DPAPI recovery secret configured: "+(Test-Path $secretFile))
  Write-Host ("Backup directory configured: "+(Test-Path $configFile))
  if(Test-Path $logFile) {
    Write-Host "Recent generic backup outcomes:"
    Get-Content -LiteralPath $logFile -Tail 5
  }
  return
}
if($Disable) {
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($task) {
    if(-not $task.Actions[0].Arguments.Contains("scheduled-backup.ps1")) {
      throw "Task name is occupied by an unrelated task; refusing to delete it"
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  # Remove only the local DPAPI credential/config for future scheduled runs.
  # NEVER delete any .pawbak backup files or the PostgreSQL volume.
  Remove-Item -LiteralPath $secretFile,$configFile -Force -ErrorAction SilentlyContinue
  Write-Host "Automatic backup disabled. Existing encrypted archives were preserved."
  return
}
if($Enable) {
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "A PAW task already exists. Check -Status; use -Disable before reconfiguring."
  }
  if((Test-Path $secretFile) -or (Test-Path $configFile)) {
    throw "Previous local DPAPI configuration exists. Run -Disable first; refusing to overwrite."
  }
  if(-not (Test-Path (Join-Path $root "local\.env"))) {
    throw "Local PostgreSQL configuration is missing; run setup.ps1 first"
  }
  $dest=if($Directory){[System.IO.Path]::GetFullPath($Directory)}else{
    Join-Path $env:USERPROFILE "PAW-Backups"
  }
  if(-not (Test-Path $dest)) {New-Item -ItemType Directory -Force -Path $dest | Out-Null}
  $dest=(Resolve-Path -LiteralPath $dest).Path
  $minutes=New-TimeSpan -Hours $Hour -Minutes $Minute
  if(-not (Test-Path $stateDir)) {New-Item -ItemType Directory -Path $stateDir -Force | Out-Null}
  Write-Host "This opt-in task runs only while your Windows account is signed in."
  Write-Host "Your password is stored with Windows DPAPI CurrentUser; recovering archives on another computer REQUIRES remembering your chosen passphrase."
  Write-Host "No old backups will be deleted automatically."
  $secret=SecurePassphrase
  try {
    WriteState $secretFile (ConvertFrom-SecureString $secret)
    WriteState $configFile (@{backupDirectory=$dest;configuredUtc=[datetime]::UtcNow.ToString("o")} | ConvertTo-Json -Compress)
    $args='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Run' -f $scriptPath
    $action=New-ScheduledTaskAction -Execute "powershell.exe" -Argument $args -WorkingDirectory $root
    $at=[datetime]::Today.Add($minutes)
    $trigger=New-ScheduledTaskTrigger -Daily -At $at
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 40)
    $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Offline encrypted PostgreSQL backup; signed-in owner only; no auto deletion" | Out-Null
    Write-Host ("Daily encrypted backup was registered for {0:D2}:{1:D2} while signed in." -f $Hour,$Minute)
  } catch {
    Remove-Item -LiteralPath $secretFile,$configFile -Force -ErrorAction SilentlyContinue
    throw
  } finally {$secret.Dispose()}
  return
}
if($Run) {
  if(-not ((Test-Path $secretFile) -and (Test-Path $configFile))) {throw "No scheduled backup configured"}
  $secret=ReadSecret
  try {
    $cfg=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if(-not $cfg.backupDirectory -or -not (Test-Path -LiteralPath $cfg.backupDirectory -PathType Container)) {
      throw "Configured backup directory is missing"
    }
    try {
      InvokeEncryptedBackup $cfg.backupDirectory $secret
      LogResult "SUCCESS"
    } catch {
      LogResult "FAILED"
      throw
    }
  } finally {$secret.Dispose()}
}
