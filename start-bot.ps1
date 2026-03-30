$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot "logs"
if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$stdout = Join-Path $logsDir "app.log"
$stderr = Join-Path $logsDir "app.err.log"
$startLog = Join-Path $logsDir "start-bot.log"
$entrypoint = Join-Path $projectRoot "dist\\index.js"

function Write-StartLog {
  param([string]$Message)
  Add-Content -Path $startLog -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Resolve-CommandPath {
  param([string]$CommandName)

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) {
    throw "Unable to resolve $CommandName on PATH"
  }

  return $command.Source
}

function Invoke-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $quotedArguments = $ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_.Replace('"', '\"')) + '"'
    } else {
      $_
    }
  }

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList ($quotedArguments -join " ") `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -Wait `
    -PassThru

  return $process.ExitCode
}

function Get-BotProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -match [regex]::Escape($entrypoint)
    }
}

function Resolve-CodexBin {
  if ($env:CODEX_BIN) {
    return $env:CODEX_BIN
  }

  $candidate = Get-ChildItem `
    -Path (Join-Path $env:USERPROFILE ".vscode\\extensions\\openai.chatgpt-*\\bin\\windows-x86_64\\codex.exe") `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($candidate) {
    return $candidate.FullName
  }

  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if ($codex) {
    return $codex.Source
  }

  return $null
}

$mutex = New-Object System.Threading.Mutex($false, "Global\FeishuCodexWorkspaceBotStarter")
$lockTaken = $false

try {
  $lockTaken = $mutex.WaitOne(0)
  if (-not $lockTaken) {
    Write-StartLog "skip: another starter instance is running"
    exit 0
  }

  $running = @(Get-BotProcesses)
  if ($running.Count -gt 0) {
    Write-StartLog "skip: bot already running, pids=$($running.ProcessId -join ',')"
    exit 0
  }

  $resolvedCodexBin = Resolve-CodexBin
  if ($resolvedCodexBin) {
    $env:CODEX_BIN = $resolvedCodexBin
    Write-StartLog "using CODEX_BIN=$resolvedCodexBin"
  }

  $npmCmd = Resolve-CommandPath "npm.cmd"
  $nodeCmd = Resolve-CommandPath "node.exe"

  if (!(Test-Path $entrypoint)) {
    Write-StartLog "dist/index.js missing; running build"
    $buildExitCode = Invoke-LoggedProcess -FilePath $npmCmd -ArgumentList @("run", "build")
    if ($buildExitCode -ne 0) {
      Write-StartLog "build failed exitCode=$buildExitCode"
      exit $buildExitCode
    }
  }

  Write-StartLog "starting bot via $nodeCmd"
  $exitCode = Invoke-LoggedProcess -FilePath $nodeCmd -ArgumentList @("dist/index.js")
  Write-StartLog "bot exited with code=$exitCode"
  exit $exitCode
} finally {
  if ($lockTaken) {
    $mutex.ReleaseMutex() | Out-Null
  }
  $mutex.Dispose()
}
