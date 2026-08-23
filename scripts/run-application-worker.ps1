$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"

if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) {
  throw "Node.js npm.cmd was not found."
}

Set-Location -LiteralPath $workspace
$workerVersion = (& git rev-parse --short=12 HEAD 2>$null)
if ($LASTEXITCODE -eq 0 -and $workerVersion) {
  $env:APPLICATION_WORKER_VERSION = $workerVersion.Trim()
}
& $npm run worker:start
exit $LASTEXITCODE
