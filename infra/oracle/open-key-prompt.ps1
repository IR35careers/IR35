# Run in a dedicated, visible -NoProfile PowerShell window. No transcripts.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 migration key setup (G1)'
Write-Host 'Use this window for hidden passphrases. Do not enter them in chat.'
Write-Host 'There are four entries: SSH twice, then OCI API twice.'
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/key_ceremony.py
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: key setup did not pass. Do not retry or delete any files; tell Codex.'
    exit 1
}
Write-Host 'Finished locally. Save both encrypted private keys and passphrases in your password manager.'
Write-Host 'Tell Codex: Keys saved. No cloud resources were created by this window.'
