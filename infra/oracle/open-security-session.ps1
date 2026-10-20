$ErrorActionPreference = 'Stop'
# Run natively on Windows; WSL Windows-executable interop is disabled on this host.
# Pipe the public-key browser request directly to Start-Process, never to logs.
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = 'wsl.exe'
$start.Arguments = '--distribution Ubuntu --exec /usr/bin/env IR35_BROWSER_BRIDGE_PIPE=1 /home/anvesh/.ir35/oci/bin/python /home/anvesh/.ir35/p1-tooling/security_session.py authenticate'
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
