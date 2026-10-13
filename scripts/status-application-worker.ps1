[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$environment = Join-Path $workspace "services\application-worker\.env"
$expectedSupervisor = Join-Path $workspace "scripts\run-application-worker.ps1"
$taskName = "IR35Careers Application Worker"
$port = 8787

if (Test-Path -LiteralPath $environment -PathType Leaf) {
  $portLine = Select-String -LiteralPath $environment -Pattern '^PORT\s*=\s*["'']?(\d+)["'']?\s*$' |
    Select-Object -Last 1
  if ($portLine -and $portLine.Matches[0].Groups[1].Value) {
    $parsedPort = [int]$portLine.Matches[0].Groups[1].Value
    if ($parsedPort -gt 0 -and $parsedPort -le 65535) { $port = $parsedPort }
  }
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName }
$usesSupervisor = $task -and @($task.Actions | Where-Object {
  $_.Arguments -like "*$expectedSupervisor*"
}).Count -gt 0
$hasRecoveryTrigger = $task -and @($task.Triggers | Where-Object {
  $_.Enabled -and $_.Repetition.Interval
}).Count -gt 0

$health = $null
$healthError = $null
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
} catch {
  $healthError = "The local worker health endpoint is unavailable."
}
$lastConnectedAt = $null
$connectionFresh = $false
if ($health.controlPlane.lastConnectedAt) {
  $lastConnectedAt = [DateTimeOffset]::Parse($health.controlPlane.lastConnectedAt)
  $connectionFresh = $lastConnectedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(-2)
}

$recommendations = @()
if (-not $task) {
  $recommendations += "Install the persistent task with scripts/install-application-worker-task.ps1."
} elseif (-not $usesSupervisor -or -not $hasRecoveryTrigger) {
  $recommendations += "The scheduled task registration is out of date. Run scripts/install-application-worker-task.ps1 again."
}
if (-not $health) {
  $recommendations += "Start the registered task with Start-ScheduledTask -TaskName 'IR35Careers Application Worker'."
} elseif (-not $connectionFresh -or [int]$health.controlPlane.consecutiveFailures -gt 0) {
  $recommendations += "The worker is running but its connection to the production claim API needs investigation."
}

$status = [pscustomobject]@{
  TaskName = $taskName
  Installed = [bool]$task
  TaskState = if ($task) { [string]$task.State } else { "Not installed" }
  UsesSupervisor = [bool]$usesSupervisor
  HasRecoveryTrigger = [bool]$hasRecoveryTrigger
  LastRunTime = if ($taskInfo) { $taskInfo.LastRunTime.ToString("o") } else { $null }
  LastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
  NextRunTime = if ($taskInfo -and $taskInfo.NextRunTime.Year -gt 2000) { $taskInfo.NextRunTime.ToString("o") } else { $null }
  HealthUrl = "http://127.0.0.1:$port/health"
  LocalWorkerRunning = [bool]($health -and $health.ok)
  ControlPlaneConnectionFresh = $connectionFresh
  Health = $health
  HealthError = $healthError
  CounterMeaning = "Health.completed counts accepted task callbacks, including paused or cancelled applications. It is not an employer-submission count."
  Recommendations = $recommendations
}

if ($Json) {
  $status | ConvertTo-Json -Depth 6
} else {
  $status | Format-List
}
