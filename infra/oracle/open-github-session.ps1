param([switch]$OwnerRetry20261125, [switch]$ShowBrowserUi, [switch]$BrowserOpenedByOwner)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'IR35 GitHub sign-in - ONE OWNER HANDOFF - NO SECRETS IN CHAT'
if ($OwnerRetry20261125) { $Host.UI.RawUI.WindowTitle = 'IR35 GitHub sign-in - RETRY 25 NOV - CURRENT DEVICE CODE' }
if ($ShowBrowserUi) { $Host.UI.RawUI.WindowTitle = 'IR35 GitHub browser sign-in - UI HANDOFF' }
if ($BrowserOpenedByOwner) { $Host.UI.RawUI.WindowTitle = 'IR35 GitHub sign-in - IN-APP BROWSER HANDOFF' }
$githubCli = 'C:\Users\anves\AppData\Local\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe'
if (-not (Test-Path -LiteralPath $githubCli -PathType Leaf)) { throw 'Installed GitHub CLI required; no fallback download.' }
Write-Host 'Complete GitHub CLI sign-in here and in your normal browser yourself.'
Write-Host 'The CLI copies its one-time device code to your clipboard. Never send it to chat.'
Write-Host 'If asked, press Enter to open GitHub. Paste the device code only into github.com.'
Write-Host 'No new SSH key is generated or uploaded; no PR merge or production change is requested.'
if ($ShowBrowserUi) {
    # Closed stdin skips the CLI's non-secret terminal confirmations. GitHub
    # authentication stays in the owner's NORMAL HEADED browser. CLI output
    # stays in this native owner window; no code/token is captured or logged.
    $loginStart = [System.Diagnostics.ProcessStartInfo]::new()
    $loginStart.FileName = $githubCli
    $loginStart.Arguments = 'auth login --hostname github.com --git-protocol https --web --clipboard --skip-ssh-key'
    $loginStart.UseShellExecute = $false
    $loginStart.RedirectStandardInput = $true
    $loginStart.RedirectStandardOutput = $false
    $loginStart.RedirectStandardError = $false
    $loginStart.CreateNoWindow = $false
    $loginProcess = [System.Diagnostics.Process]::new()
    $loginProcess.StartInfo = $loginStart
    if (-not $loginProcess.Start()) { throw 'GitHub CLI did not start; no automatic retry.' }
    $loginProcess.StandardInput.Close()
    if (-not $BrowserOpenedByOwner) {
        Start-Process -FilePath 'https://github.com/login/device' -ErrorAction Stop
    }
    $loginProcess.WaitForExit()
    $loginExitCode = $loginProcess.ExitCode
    $loginProcess.Dispose()
} else {
    & $githubCli auth login --hostname github.com --git-protocol https --web --clipboard --skip-ssh-key
    $loginExitCode = $LASTEXITCODE
}
if ($loginExitCode -ne 0) {
    Write-Host 'STOP: GitHub sign-in did not complete. No automatic retry.'
    exit 1
}
Write-Host 'GitHub sign-in completed. Tell Codex when the other access prompts are also complete.'
