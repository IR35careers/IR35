$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 API key unlock (G1)'
Write-Host 'Enter the OCI API passphrase you just created, once. Not the SSH passphrase.'
Write-Host 'The input is hidden; do not enter it in chat. This window makes read-only checks only.'
& wsl.exe --distribution Ubuntu --exec /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/unlock_api.py
if ($LASTEXITCODE -ne 0) {
    Write-Host 'STOP: verification did not pass. Do not rerun or delete keys; tell Codex.'
    exit 1
}
