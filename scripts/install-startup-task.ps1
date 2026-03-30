$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "FeishuCodexWorkspaceBot"
$startScript = Join-Path $projectRoot "start-bot.ps1"

$action = New-ScheduledTaskAction `
  -Execute "PowerShell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start Feishu Codex Workspace bot at Windows startup" `
  -RunLevel Highest `
  -Force
