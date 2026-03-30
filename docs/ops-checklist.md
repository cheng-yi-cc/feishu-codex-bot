# Operations Checklist

## Pre-Start

- `.env` exists and all required keys set
- `codex login status` is valid on host
- `CODEX_WORKDIR` exists and is writable
- `LOG_DIR` exists or can be created by the bot
- `FEISHU_ALLOW_OPEN_IDS` contains intended pilot users
- `start-bot.ps1` points at this checkout and `dist/index.js` is buildable
- Startup task installed with `scripts/install-startup-task.ps1` when running as a boot service

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
- confirm `dist/index.js` exists after build
- open Task Scheduler history for `FeishuCodexWorkspaceBot`

## Rollback

1. `pm2 stop feishu-codex-bot`
2. Restore previous build/version
3. Keep SQLite DB file unless schema rollback required
4. Start old version and verify `/status`
