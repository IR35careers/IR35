param([switch]$OwnerRetryOnce, [switch]$OwnerFourHour, [switch]$OwnerFourHourReopen, [switch]$OwnerReadyFourHour)
$ErrorActionPreference = 'Stop'
if (([int]$OwnerRetryOnce.IsPresent + [int]$OwnerFourHour.IsPresent + [int]$OwnerFourHourReopen.IsPresent + [int]$OwnerReadyFourHour.IsPresent) -gt 1) { throw 'Choose only the specifically approved single prompt.' }
$Host.UI.RawUI.WindowTitle = 'IR35 SSH agent — once this boot (NOT OCI API)'
if ($OwnerRetryOnce) { $Host.UI.RawUI.WindowTitle = 'IR35 SSH agent - OWNER REQUESTED RETRY - NOT OCI API' }
if ($OwnerFourHour) { $Host.UI.RawUI.WindowTitle = 'IR35 SSH unlock - FOUR HOURS - ONE PROMPT - NOT OCI API' }
if ($OwnerFourHourReopen) { $Host.UI.RawUI.WindowTitle = 'IR35 SSH unlock - NEW FOUR-HOUR LEASE - ONE PROMPT - NOT OCI API' }
if ($OwnerReadyFourHour) { $Host.UI.RawUI.WindowTitle = 'IR35 SSH unlock - READY HANDOFF - ONE PROMPT - NOT OCI API' }
Write-Host 'This is the EXISTING SSH Ed25519 passphrase, NOT the OCI API passphrase.'
Write-Host 'ssh-add reads it at the native hidden prompt. Nothing is saved in config, env or logs.'
Write-Host 'The encrypted key on disk is unchanged; only the agent holds the unlocked identity.'
$AgentScript = Join-Path $PSScriptRoot 'ssh_agent_session.py'
$WslAgentScript = & wsl.exe --distribution Ubuntu --exec wslpath -a $AgentScript
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($WslAgentScript)) { throw 'Cannot resolve the reviewed SSH-agent helper; no prompt.' }
$AgentOperation = if ($OwnerRetryOnce) { 'load-owner-retry-and-hold' } else { 'load-and-hold' }
if ($OwnerFourHour) { $AgentOperation = 'load-owner-four-hour-and-hold' }
if ($OwnerFourHourReopen) { $AgentOperation = 'load-owner-four-hour-reopen-and-hold' }
if ($OwnerReadyFourHour) { $AgentOperation = 'load-owner-ready-four-hour-and-hold' }
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python $WslAgentScript.Trim() $AgentOperation
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: SSH identity was not loaded; no automatic re-prompt this boot. Tell Codex.'
    exit 1
}
Write-Host 'SSH identity loaded. No more passphrase prompts are needed while this agent remains alive.'
