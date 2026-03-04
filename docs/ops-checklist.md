# Operations Checklist

## Pre-Start

- `.env` exists and all required keys set
- `codex login status` is valid on host
- `CODEX_WORKDIR` exists and is writable
- `FEISHU_ALLOW_OPEN_IDS` contains intended pilot users

## Start Verification

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run start` (or PM2)
5. Check `GET /healthz`

## Runtime Checks

- Queue length stays near 0 when idle
- No repeated auth errors in logs
- Bot replies to `/status`
- `/new` clears session context

## Incident Triage

- If Feishu receives but bot does not reply:
- check `FEISHU_ALLOW_OPEN_IDS`
- check command prefix is `/ask`
- check codex timeout and stderr in logs

- If health endpoint unavailable:
- check process manager status
- check `HEALTH_PORT` conflicts

## Rollback

1. `pm2 stop feishu-codex-bot`
2. Restore previous build/version
3. Keep SQLite DB file unless schema rollback required
4. Start old version and verify `/status`
