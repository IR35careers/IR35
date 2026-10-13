[CmdletBinding()]
param([switch]$ValidateOnly)

$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$environment = Join-Path $workspace "services\application-worker\.env"
$workerEntry = Join-Path $workspace "services\application-worker\dist\server.mjs"

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node.js was not found."
}
if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
  throw "The application worker environment was not found."
}
if (-not (Test-Path -LiteralPath $workerEntry -PathType Leaf)) {
  throw "Build the application worker with npm run worker:build before starting it."
}

# Let Node parse the same env file that the child will use. Return only the
# non-secret settings needed by the supervisor, never the environment itself.
$configurationJson = & $node "--env-file=$environment" -e @'
const origin = new URL(process.env.IR35CAREERS_APP_URL || 'https://www.ir35careers.com');
const secretConfigured = (process.env.APPLICATION_WORKER_SECRET || '').trim().length >= 32;
const port = Number(process.env.PORT || 8787);
if (origin.protocol !== 'https:' || !secretConfigured || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Worker settings require an HTTPS app origin, a 32-character secret, and a valid port.');
  process.exit(2);
}
console.log(JSON.stringify({ origin: origin.origin, port }));
'@
if ($LASTEXITCODE -ne 0) {
  throw "The application worker configuration is invalid."
}
$configuration = $configurationJson | ConvertFrom-Json

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

if ($ValidateOnly) {
  [pscustomobject]@{
    Valid = $true
    Workspace = $workspace
    Node = $node
    Browser = $env:CHROME_EXECUTABLE_PATH
    AppOrigin = $configuration.origin
    HealthUrl = "http://127.0.0.1:$($configuration.port)/health"
  } | ConvertTo-Json
  exit 0
}

# Ignore duplicate supervisors for this checkout. Task Scheduler prevents
# duplicates only within its own registration, not a manual launch.
$workspaceHash = [System.Security.Cryptography.SHA256]::Create()
try {
  $workspaceIdentity = [BitConverter]::ToString(
    $workspaceHash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($workspace.ToLowerInvariant()))
  ).Replace("-", "").Substring(0, 24)
} finally {
  $workspaceHash.Dispose()
}
$supervisorMutex = [System.Threading.Mutex]::new($false, "Local\IR35CareersWorker-$workspaceIdentity")
if (-not $supervisorMutex.WaitOne(0)) {
  $supervisorMutex.Dispose()
  exit 0
}

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

# Task Scheduler can terminate the PowerShell supervisor before its finally
# block runs, leaving the Node child behind. Starting another child then fails
# with EADDRINUSE and every queued application appears to stop immediately.
# A new scheduled supervisor is authoritative, so remove only processes whose
# command line identifies this application worker before launching one owner.
$existingWorkers = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "node.exe" -and
    (
      $_.CommandLine -like "*$workerEntry*" -or
      $_.CommandLine -like "*$(Join-Path $workspace 'services\application-worker\server.ts')*"
    )
  }

foreach ($existingWorker in $existingWorkers) {
  Add-Content `
    -LiteralPath $watchdog `
    -Value "worker_watchdog_cleanup { at: '$([DateTime]::UtcNow.ToString("o"))', pid: '$($existingWorker.ProcessId)' }"
  Stop-Process -Id $existingWorker.ProcessId -Force -ErrorAction SilentlyContinue
}

if ($existingWorkers.Count -gt 0) {
  Start-Sleep -Seconds 2
}

$worker = Start-Process `
  -FilePath $node `
  -ArgumentList @(
    "--env-file=`"$environment`"",
    "`"$workerEntry`""
  ) `
  -WorkingDirectory $workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

$startupGraceEnds = [DateTime]::UtcNow.AddSeconds(20)
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
        "http://127.0.0.1:$($configuration.port)/health" 2>$null
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
  $supervisorMutex.ReleaseMutex()
  $supervisorMutex.Dispose()
}
