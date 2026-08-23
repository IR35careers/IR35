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
$watchdog = Join-Path $workspace "services\application-worker\runtime.watchdog.log"
$curl = (Get-Command curl.exe -ErrorAction Stop).Source

Add-Content `
  -LiteralPath $watchdog `
  -Value "worker_watchdog_start { at: '$([DateTime]::UtcNow.ToString("o"))', version: '$($env:APPLICATION_WORKER_VERSION)' }"

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
  -PassThru

$startupGraceEnds = [DateTime]::UtcNow.AddSeconds(45)
$consecutiveHealthFailures = 0

try {
  while (-not $worker.HasExited) {
    Start-Sleep -Seconds 10
    $worker.Refresh()
    if ($worker.HasExited) { break }
    if ([DateTime]::UtcNow -lt $startupGraceEnds) { continue }

    $healthy = $false
    try {
      $healthBody = & $curl `
        --silent `
        --fail `
        --max-time 4 `
        "http://127.0.0.1:8787/health" 2>$null
      $healthy = $LASTEXITCODE -eq 0 -and $healthBody -match '"ok"\s*:\s*true'
    } catch {
      $healthy = $false
    }

    if ($healthy) {
      $consecutiveHealthFailures = 0
      continue
    }

    $consecutiveHealthFailures += 1
    if ($consecutiveHealthFailures -lt 3) { continue }

    Add-Content `
      -LiteralPath $watchdog `
      -Value "worker_watchdog_restart { at: '$([DateTime]::UtcNow.ToString("o"))', reason: 'health endpoint failed three consecutive checks' }"
    Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
    $worker.WaitForExit()
    exit 2
  }

  exit $worker.ExitCode
} finally {
  if (-not $worker.HasExited) {
    Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
  }
}
