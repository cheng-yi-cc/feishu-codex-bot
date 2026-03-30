$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot "logs"
if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$stdout = Join-Path $logsDir "app.log"
$stderr = Join-Path $logsDir "app.err.log"

if (!(Test-Path (Join-Path $projectRoot "dist\\index.js"))) {
  npm.cmd run build
}

Start-Process `
  -FilePath "node.exe" `
  -ArgumentList "dist/index.js" `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden
