$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 P1 read-only resource audit (G1)'
Write-Host 'Use the EXISTING OCI API passphrase. No new keys and no resource creation.'
Write-Host 'The passphrase is hidden and held only for this read-only inventory, never saved.'
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/resource_audit.py
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: inventory did not pass. Do not rerun or delete keys; tell Codex.'
    exit 1
}
