$ErrorActionPreference = "Stop"

$taskName = "IR35Careers Application Worker"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$environment = Join-Path $workspace "services\application-worker\.env"
$worker = Join-Path $workspace "services\application-worker\dist\server.mjs"
$userId = if ($env:USERDOMAIN) {
  "$env:USERDOMAIN\$env:USERNAME"
} else {
  $env:USERNAME
}

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw "Node.js was not found."
}
if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
  throw "The application worker environment was not found."
}
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
  throw "Build the application worker before installing the task."
}

$workerVersion = (& git -C $workspace rev-parse --short=12 HEAD 2>$null)
if ($LASTEXITCODE -eq 0 -and $workerVersion) {
  $workerVersion = $workerVersion.Trim()
  $environmentText = [System.IO.File]::ReadAllText($environment)
  $versionLine = "APPLICATION_WORKER_VERSION=`"$workerVersion`""
  if ($environmentText -match "(?m)^APPLICATION_WORKER_VERSION=.*$") {
    $environmentText = [regex]::Replace(
      $environmentText,
      "(?m)^APPLICATION_WORKER_VERSION=.*$",
      $versionLine
    )
  } else {
    $environmentText = $environmentText.TrimEnd() + [Environment]::NewLine + $versionLine + [Environment]::NewLine
  }
  [System.IO.File]::WriteAllText(
    $environment,
    $environmentText,
    [System.Text.UTF8Encoding]::new($false)
  )
}

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "--env-file=`"$environment`" `"$worker`"" `
  -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -Priority 4 `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings

Register-ScheduledTask `
  -TaskName $taskName `
  -InputObject $task `
  -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $taskName
Write-Output "$($registered.TaskName): $($registered.State)"
