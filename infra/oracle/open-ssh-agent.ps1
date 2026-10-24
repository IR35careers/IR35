$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 SSH agent — once this boot (NOT OCI API)'
Write-Host 'This is the EXISTING SSH Ed25519 passphrase, NOT the OCI API passphrase.'
Write-Host 'ssh-add reads it at the native hidden prompt. Nothing is saved in config, env or logs.'
Write-Host 'The encrypted key on disk is unchanged; only the agent holds the unlocked identity.'
$AgentScript = Join-Path $PSScriptRoot 'ssh_agent_session.py'
$WslAgentScript = & wsl.exe --distribution Ubuntu --exec wslpath -a $AgentScript
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($WslAgentScript)) { throw 'Cannot resolve the reviewed SSH-agent helper; no prompt.' }
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python $WslAgentScript.Trim() load-and-hold
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: SSH identity was not loaded; no automatic re-prompt this boot. Tell Codex.'
    exit 1
}
Write-Host 'SSH identity loaded. No more passphrase prompts are needed while this agent remains alive.'
