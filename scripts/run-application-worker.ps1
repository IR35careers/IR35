$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"

if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) {
  throw "Node.js npm.cmd was not found."
}

Set-Location -LiteralPath $workspace
& $npm run worker:start
exit $LASTEXITCODE
