$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 SSH agent — once this boot (NOT OCI API)'
Write-Host 'This is the EXISTING SSH Ed25519 passphrase, NOT the OCI API passphrase.'
Write-Host 'ssh-add reads it at the native hidden prompt. Nothing is saved in config, env or logs.'
Write-Host 'The encrypted key on disk is unchanged; only the agent holds the unlocked identity.'
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/ssh_agent_session.py load
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: SSH identity was not loaded; no automatic re-prompt this boot. Tell Codex.'
    exit 1
}
Write-Host 'SSH identity loaded. No more passphrase prompts are needed while this agent remains alive.'
