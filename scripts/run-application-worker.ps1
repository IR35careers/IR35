$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node.js was not found."
}

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
