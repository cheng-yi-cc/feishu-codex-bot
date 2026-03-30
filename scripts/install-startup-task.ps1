$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "FeishuCodexWorkspaceBot"
$startScript = Join-Path $projectRoot "start-bot.ps1"
$startupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "FeishuCodexWorkspaceBot.lnk"
$startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

function Install-StartupShortcut {
  $powerShellPath = (Get-Command "PowerShell.exe" -ErrorAction Stop).Source
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($startupShortcutPath)
  $shortcut.TargetPath = $powerShellPath
  $shortcut.Arguments = $startArguments
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.Description = "Start Feishu Codex Workspace bot at user logon"
  $shortcut.Save()
}

$action = New-ScheduledTaskAction `
  -Execute "PowerShell.exe" `
  -Argument $startArguments

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

try {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Start Feishu Codex Workspace bot at Windows startup" `
    -RunLevel Highest `
    -Force `
    -ErrorAction Stop | Out-Null

  if (Test-Path -LiteralPath $startupShortcutPath) {
    Remove-Item -LiteralPath $startupShortcutPath -Force
  }

  Write-Output "Installed startup mode: TaskScheduler"
} catch {
  if ($_.Exception.Message -notmatch "Access is denied") {
    throw
  }

  Install-StartupShortcut
  Write-Warning "Task Scheduler registration was denied; installed a Startup folder shortcut instead."
  Write-Output "Installed startup mode: StartupShortcut"
}
