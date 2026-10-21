[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 staging test-account login — ONE authorised attempt 2 — NOT OCI or SSH'
$credential = $null
$pointer = [IntPtr]::Zero
function New-IR35LoginStart([ValidateSet('--status','--stdin-secret')][string]$Mode) {
  $start = [Diagnostics.ProcessStartInfo]::new('wsl.exe')
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $recoveryMode = if ($Mode -eq '--status') { '--named-status' } else { '--named-stdin-secret' }
  foreach ($argument in @('-d','Ubuntu','--cd','/mnt/c/Users/anves/.codex/worktrees/bot-handoff/ir35careers','/home/anvesh/.ir35/oci/bin/python','infra/oracle/p4_recovery.py',$recoveryMode)) { $start.ArgumentList.Add($argument) }
  return $start
}
try {
  Write-Host 'Staging-only login for anvesh.mannuru+ir35test@gmail.com. Never enter an OCI/SSH passphrase here.'
  Write-Host 'ONE owner-authorised additional attempt. No automatic retries. The first failed attempt is retained.'
  # Check the durable state BEFORE asking the owner for any credential.
  $check = [Diagnostics.Process]::Start((New-IR35LoginStart '--status'))
  $check.StandardInput.Close()
  $checkOutput = $check.StandardOutput.ReadToEndAsync()
  $checkError = $check.StandardError.ReadToEndAsync()
  if (-not $check.WaitForExit(120000)) { $check.Kill($true); throw 'Status check timed out; no password requested.' }
  $state = $checkOutput.GetAwaiter().GetResult() | ConvertFrom-Json
  if ($check.ExitCode -ne 0 -or $state.status -ne 'READY_STOPPED') { throw 'Attempt is not ready; no password requested. Reconcile the saved result.' }
  $credential = Read-Host 'Existing TEST ACCOUNT password (hidden)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
  $text = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $start = New-IR35LoginStart '--stdin-secret'
  $child = [Diagnostics.Process]::Start($start)
  $stdout = $child.StandardOutput.ReadToEndAsync()
  $stderr = $child.StandardError.ReadToEndAsync()
  $child.StandardInput.WriteLine((@{ password=$text } | ConvertTo-Json -Compress))
  $child.StandardInput.Close()
  $text = $null
  if (-not $child.WaitForExit(420000)) { $child.Kill($true); throw 'Staging test timed out; reconcile the durable journal, never replay.' }
  $result = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json
  if ($child.ExitCode -ne 0 -or $result.status -ne 'PASS') { throw 'Staging login stopped; secret and raw output withheld. Do not retry this window.' }
  Write-Host 'PASS: staging-only password login, fresh JWT, refresh and RLS verified; test session logged out. No cloud login.'
} catch {
  Write-Host 'STOP: staging test did not pass; no credential output. Tell Codex to reconcile, not retry.'
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $text = $null
  if ($credential) { $credential.Dispose() }
  [void](Read-Host 'Press Enter to close')
}
