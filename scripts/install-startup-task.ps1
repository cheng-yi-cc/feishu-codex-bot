$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "FeishuCodexWorkspaceBot"
$startScript = Join-Path $projectRoot "start-bot.ps1"
$startupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "FeishuCodexWorkspaceBot.lnk"
$startArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""

function Install-StartupShortcut {
  $powerShellPath = (Get-Command "PowerShell.exe" -ErrorAction Stop).Source
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($startupShortcutPath)
  $shortcut.TargetPath = $powerShellPath
  $shortcut.Arguments = $startArguments
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.WindowStyle = 7  # Minimized
  $shortcut.Description = "Start Feishu Codex Workspace bot at user logon"
  $shortcut.Save()
}

$action = New-ScheduledTaskAction `
  -Execute "PowerShell.exe" `
  -Argument $startArguments `
  -WorkingDirectory $projectRoot

# Use AtLogOn instead of AtStartup so the user's session and PATH are available
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Add a 15-second delay so the desktop and network are fully initialised
$trigger.Delay = 'PT15S'

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
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
    -Description "Start Feishu Codex Workspace bot when the current user logs on" `
    -Force `
    -ErrorAction Stop | Out-Null

  # Task registered successfully — clean up any leftover startup shortcut
  if (Test-Path -LiteralPath $startupShortcutPath) {
    Remove-Item -LiteralPath $startupShortcutPath -Force
  }
  Write-Output "Installed startup mode: TaskScheduler (AtLogOn)"
} catch {
  # Check FullyQualifiedErrorId (language-independent) and exception message (fallback)
  $isAccessDenied = $_.FullyQualifiedErrorId -match '0x80070005' -or
                    $_.Exception.Message -match 'Access is denied|拒绝访问'
  if (-not $isAccessDenied) {
    throw
  }

  Install-StartupShortcut
  Write-Warning "Task Scheduler registration was denied; installed a Startup folder shortcut instead."
  Write-Output "Installed startup mode: StartupShortcut"
}
