$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node.js was not found."
}

# The packaged serverless Chromium binary is extracted beneath the Windows
# temporary directory and can disappear after cleanup or a reboot. A
# persistent desktop worker should use the installed browser instead. Respect
# an explicit valid override first, then select Chrome or Edge from their
# standard installation locations.
$configuredBrowser = $env:CHROME_EXECUTABLE_PATH
if (-not $configuredBrowser -or -not (Test-Path -LiteralPath $configuredBrowser -PathType Leaf)) {
  $browserCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
  )
  $configuredBrowser = $browserCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
}

if (-not $configuredBrowser) {
  throw "Chrome or Edge was not found for the application worker."
}

$env:CHROME_EXECUTABLE_PATH = [System.IO.Path]::GetFullPath($configuredBrowser)

Set-Location -LiteralPath $workspace
$workerVersion = (& git rev-parse --short=12 HEAD 2>$null)
if ($LASTEXITCODE -eq 0 -and $workerVersion) {
  $env:APPLICATION_WORKER_VERSION = $workerVersion.Trim()
}

$stdout = Join-Path $workspace "services\application-worker\runtime.stdout.log"
$stderr = Join-Path $workspace "services\application-worker\runtime.stderr.log"
$worker = Start-Process `
  -FilePath $node `
  -ArgumentList @(
    "--env-file=services/application-worker/.env",
    "--import",
    "tsx",
    "services/application-worker/server.ts"
  ) `
  -WorkingDirectory $workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru `
  -Wait

exit $worker.ExitCode
