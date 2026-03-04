$ErrorActionPreference = "Stop"

$projectRoot = "C:\Users\45057\.codex\feishu-codex-bot"
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot "logs"
if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$userNpmBin = Join-Path $env:APPDATA "npm"
if ((Test-Path $userNpmBin) -and (-not ($env:PATH -split ";" | Where-Object { $_ -eq $userNpmBin }))) {
  $env:PATH = "$userNpmBin;$env:PATH"
}

$startLog = Join-Path $logsDir "start-bot.log"

function Write-StartLog {
  param([string]$Message)
  Add-Content -Path $startLog -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Get-BotProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -match "feishu-codex-bot" -and (
        $_.CommandLine -match "src/index.ts" -or $_.CommandLine -match "dist/index.js"
      )
    }
}

function Wait-ForHealth {
  param([int]$MaxTries = 12)
  for ($i = 1; $i -le $MaxTries; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/healthz" -TimeoutSec 3
      if ($health.ok -eq $true) {
        return $true
      }
    } catch {
      # healthz not ready yet
    }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Resolve-CodexBin {
  $candidate = Get-ChildItem `
    -Path (Join-Path $env:USERPROFILE ".vscode\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe") `
    -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($candidate) {
    return $candidate.FullName
  }

  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if ($codex) {
    return "codex"
  }

  return $null
}

$mutex = New-Object System.Threading.Mutex($false, "Global\FeishuCodexBotStarter")
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

  $networkReady = $false
  for ($n = 1; $n -le 6; $n++) {
    if (Test-NetConnection -ComputerName "open.feishu.cn" -Port 443 -InformationLevel Quiet) {
      $networkReady = $true
      break
    }
    Start-Sleep -Seconds 5
  }
  if (-not $networkReady) {
    Write-StartLog "network check timeout, continue start"
  }

  $resolvedCodexBin = Resolve-CodexBin
  if ($resolvedCodexBin) {
    $env:CODEX_BIN = $resolvedCodexBin
    Write-StartLog "using CODEX_BIN=$resolvedCodexBin"
  } else {
    Write-StartLog "codex binary not found before start"
  }

  $npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
  $stdout = Join-Path $logsDir "dev.out.log"
  $stderr = Join-Path $logsDir "dev.err.log"

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    Write-StartLog "start attempt=$attempt"
    Start-Process -FilePath $npmCmd `
      -ArgumentList "run dev" `
      -WorkingDirectory $projectRoot `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr | Out-Null

    if (Wait-ForHealth -MaxTries 12) {
      $started = @(Get-BotProcesses)
      Write-StartLog "started and healthy, pids=$($started.ProcessId -join ',')"
      exit 0
    }

    $toStop = @(Get-BotProcesses)
    foreach ($p in $toStop) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-StartLog "attempt=$attempt failed, cleaned pids=$($toStop.ProcessId -join ',')"
    Start-Sleep -Seconds 3
  }

  Write-StartLog "all start attempts failed"
  exit 1
} finally {
  if ($lockTaken) {
    $mutex.ReleaseMutex() | Out-Null
  }
  $mutex.Dispose()
}
