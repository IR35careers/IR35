param()
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 Auth export - ONE ATTEMPT - HIDDEN TOKEN'
$exporter = Join-Path $PSScriptRoot 'export_auth_settings.py'
$expected = '789c8ab31e25e5da2c4bafe64af9c05fb5cfcc0c60158a52e76f1f7a0d5f6b3b'
if ((Get-FileHash -LiteralPath $exporter -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Reviewed exporter hash mismatch; no prompt or request.'
}
Write-Host 'Create a short-lived read-only Supabase token yourself, if you have not already.'
Write-Host 'Paste it ONLY at the hidden Python prompt below. Nothing echoes.'
Write-Host 'Do not put the token into chat, a command, a file or an environment variable.'
Write-Host 'This makes at most ONE read-only request. No automatic retry.'
& 'C:\Python314\python.exe' $exporter
$exportExit = $LASTEXITCODE
if ($exportExit -eq 0) {
    Write-Host 'Export finished. Revoke the token NOW, then tell Codex: Auth export complete; token revoked.'
} else {
    Write-Host 'STOP. Do not rerun. Revoke the token, then tell Codex the export failed; token revoked.'
}
Write-Host 'Never send the token or exported file contents to Codex.'
Read-Host 'After revoking the token, press Enter to close this window' | Out-Null
exit $exportExit
