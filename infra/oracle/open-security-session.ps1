param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
# Use PowerShell7/.NET argument lists. Never execute a stale copied helper.
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell7 is required; no browser opened.' }
$currentScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'security_session.py')).Path
$linuxScript = (& wsl.exe --distribution Ubuntu --exec /usr/bin/wslpath -u $currentScript | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxScript.StartsWith('/mnt/c/') -or
    -not $linuxScript.EndsWith('/infra/oracle/security_session.py') -or $linuxScript.Contains("`n")) {
    throw 'Reviewed checkout helper path required; no browser opened.'
}
if ($ValidateOnly) {
    @{ status='PASS'; sourceFromCurrentCheckout=$true; helperSHA256=(Get-FileHash -LiteralPath $currentScript -Algorithm SHA256).Hash.ToLowerInvariant(); browserOpened=$false; cloudRequests=0 } | ConvertTo-Json -Compress
    exit 0
}
$busy = (& wsl.exe --distribution Ubuntu --exec /usr/bin/ss -H -ltn 'sport = :8181' | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $busy.Length -ne 0) { throw 'Existing/unclear browser callback listener; no duplicate login opened.' }
# Run natively on Windows; WSL Windows-executable interop is disabled on this host.
# Pipe the public-key browser request directly to Start-Process, never to logs.
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = 'wsl.exe'
foreach ($argument in @('--distribution','Ubuntu','--exec','/usr/bin/env','IR35_BROWSER_BRIDGE_PIPE=1','/home/anvesh/.ir35/oci/bin/python',$linuxScript,'authenticate')) {
    $start.ArgumentList.Add($argument)
}
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
$opened = $false
$deadline = [DateTime]::UtcNow.AddMinutes(15)
try {
    if (-not $process.Start()) { throw 'Session child did not start.' }
    $errors = $process.StandardError.ReadToEndAsync()
    while ($true) {
        $pending = $process.StandardOutput.ReadLineAsync()
        while (-not $pending.Wait(1000)) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Browser sign-in timed out; no retry.' }
        }
        $line = $pending.Result
        if ($null -eq $line) { break }
        if ($line.StartsWith('IR35_BROWSER_REQUEST ')) {
            if ($opened) { throw 'Duplicate browser request refused.' }
            $uri = [Uri]::new($line.Substring(21))
            if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'login.uk-london-1.oraclecloud.com' -or
                $uri.AbsolutePath -ne '/v1/oauth2/authorize' -or $uri.Fragment -ne '') {
                throw 'Unexpected browser destination refused.'
            }
            Start-Process -FilePath $uri.AbsoluteUri -ErrorAction Stop
            $opened = $true
            Write-Output 'Oracle browser opened. Complete your own sign-in/MFA; no API passphrase.'
        } elseif ($line -eq 'PASS: ir35 browser session saved owner-only. Routine calls use SecurityToken; old keys unchanged.') {
            Write-Output $line
        }
        # All other child output suppressed, including any unexpected URL/token.
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        # Never forward raw child errors; a metadata-only diagnostic is sufficient.
        Write-Output 'STOP: browser session did not complete. No automatic retry or API-key fallback.'
        exit 1
    }
} catch {
    Write-Output 'STOP: native browser session launcher failed; raw output suppressed. No automatic retry.'
    exit 1
} finally {
    if ($process.Id -and -not $process.HasExited) { $process.Kill() }
    $process.Dispose()
}
