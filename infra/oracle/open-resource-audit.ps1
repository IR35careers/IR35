$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 P1 read-only resource audit (SecurityToken)'
Write-Host 'Uses browser session ir35; no API-key or passphrase fallback.'
Write-Host 'No new keys and no resource creation.'
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/resource_audit.py
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: inventory did not pass. Do not rerun or delete keys; tell Codex.'
    exit 1
}
