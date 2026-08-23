$ErrorActionPreference = "Stop"

$taskName = "IR35Careers Application Worker"
$runner = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "run-application-worker.ps1")
)
$powerShell = (Get-Command pwsh.exe -ErrorAction Stop).Source
$userId = if ($env:USERDOMAIN) {
  "$env:USERDOMAIN\$env:USERNAME"
} else {
  $env:USERNAME
}

if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "The application worker runner was not found."
}

$action = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
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
