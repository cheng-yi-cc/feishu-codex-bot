# Operations Checklist

## Pre-Start

- `.env` exists and all required keys set
- `codex login status` is valid on host
- `CODEX_WORKDIR` exists and is writable
- `LOG_DIR` exists or can be created by the bot
- `FEISHU_ALLOW_OPEN_IDS` contains intended pilot users
- `start-bot.ps1` points at this checkout and `dist/index.js` is buildable
- `node.exe` and `npm.cmd` resolve successfully from the account that will run the startup task
- Startup install completed with `scripts/install-startup-task.ps1` (Task Scheduler when permitted, otherwise a Startup folder shortcut)

## Start Verification

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run start` (or `.\start-bot.ps1` / PM2)
5. Check `GET /healthz`
6. Confirm `supervisor.restartCount` is `0`
7. Confirm `codexWorkdir` and `logDir` in the health payload match the expected paths

## Runtime Checks

- Queue length stays near 0 when idle
- No repeated auth errors in logs
- Bot replies to `/status`
- `/new` clears session context
- `logs/app.log` and `logs/app.err.log` are updating
- `logs/start-bot.log` shows the last launch attempt and exit code
- `supervisor.lastErrorAt` remains `null` during steady state

## Incident Triage

- If Feishu receives but bot does not reply:
- check `FEISHU_ALLOW_OPEN_IDS`
- check command prefix is `/ask`
- check codex timeout and stderr in logs

- If health endpoint unavailable:
- check process manager status
- check `HEALTH_PORT` conflicts
- check whether `CODEX_BIN` is resolvable on the host
- inspect `logs/app.err.log` for supervisor preflight failures

- If the startup task launches but the bot never stays healthy:
- rerun `.\start-bot.ps1` manually from PowerShell
- inspect `logs/start-bot.log` for command resolution, build, or duplicate-process skips
- confirm `dist/index.js` exists after build
- if Task Scheduler mode was used, open Task Scheduler history for `FeishuCodexWorkspaceBot`
- if Startup shortcut mode was used, check `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FeishuCodexWorkspaceBot.lnk`

## Rollback

1. `pm2 stop feishu-codex-bot`
2. Restore previous build/version
3. Keep SQLite DB file unless schema rollback required
4. Start old version and verify `/status`
