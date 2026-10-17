$ErrorActionPreference = "Stop"

$taskName = "IR35Careers Application Worker"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$environment = Join-Path $workspace "services\application-worker\.env"
$worker = Join-Path $workspace "services\application-worker\dist\server.mjs"
$supervisor = Join-Path $workspace "scripts\run-application-worker.ps1"
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
if (-not (Test-Path -LiteralPath $supervisor -PathType Leaf)) {
  throw "The application worker supervisor was not found."
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
  -Execute $powershell `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$supervisor`"" `
  -WorkingDirectory $workspace
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
# A logon-only task remains stopped after an unexpected termination. This
# lightweight recovery trigger is ignored while the supervisor is healthy and
# restarts it within five minutes if Windows, an update or a browser crash ends
# the process.
$recoveryTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At ((Get-Date).AddMinutes(1)) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
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
  -Trigger @($logonTrigger, $recoveryTrigger) `
  -Principal $principal `
  -Settings $settings

Register-ScheduledTask `
  -TaskName $taskName `
  -InputObject $task `
  -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $taskName
Write-Output "$($registered.TaskName): $($registered.State)"
