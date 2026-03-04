# Feishu Codex Bot

Standalone TypeScript service that receives Feishu messages via WebSocket and routes chat messages to `codex exec`.

## Features

- Feishu WebSocket event intake (`im.message.receive_v1`)
- Safe command gate:
  - DM plain text can directly trigger Codex
  - Group requires `@bot` (plain text and `/ask` both supported)
- SQLite session memory with `/new` reset
- Session-level model and thinking-level switch (`/model`, `/think`)
- `/status` operational status command
- Global serial queue for single shared `CODEX_WORKDIR`
- Chunked Feishu text replies
- Typing reaction (`Typing`) while Codex is running
- Receive image/file messages, download to local workspace, and pass to Codex
- Support Codex sending image/file back via response directives
- Health endpoint: `GET /healthz`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
cp .env.example .env
```

3. Fill `.env` values.

4. Start in dev mode:

```bash
npm run dev
```

## Environment Variables

Required:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

Optional defaults:

- `FEISHU_DOMAIN=feishu`
- `FEISHU_ALLOW_OPEN_IDS=ou_xxx,ou_yyy`（留空表示不启用白名单）
- `FEISHU_REQUIRE_MENTION=true`
- `FEISHU_TRIGGER_PREFIX=/ask` (fixed in v1)
- `CODEX_BIN=codex`
- `CODEX_WORKDIR=C:\Users\45057\.codex\feishu-codex-bot\workspace`
- `CODEX_SANDBOX_MODE=danger-full-access` (fixed in v1)
- `CODEX_TIMEOUT_MS=120000`
- `CODEX_HISTORY_TURNS=20`
- `CODEX_DEFAULT_MODEL=gpt-5`
- `CODEX_DEFAULT_THINKING_LEVEL=medium` (`low|medium|high`)
- `DB_PATH=./data/bot.sqlite`
- `LOG_LEVEL=info`
- `HEALTH_PORT=8787`

## Build and Run

```bash
npm run typecheck
npm test
npm run build
npm run start
```

## PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 logs feishu-codex-bot
pm2 restart feishu-codex-bot
```

## Commands in Feishu

- `<question>`: execute via Codex（私聊可直接发；群聊需 `@bot`）
- `/ask <question>`: execute via Codex（兼容旧触发方式）
- `/new`: clear current session memory
- `/status`: show runtime status
- `/model`: show current model setting
- `/model <name>`: set session model
- `/model default`: reset to default model
- `/think`: show current thinking level
- `/think <low|medium|high>`: set session thinking level
- `/think default`: reset to default thinking level

## Codex Attachment Directives

If Codex needs to send image/file back, it can output directives in the final text:

- `<send_image path="relative/or/absolute/path/inside/workdir.png" />`
- `<send_file path="relative/or/absolute/path/inside/workdir.ext" />`

Only existing files under `CODEX_WORKDIR` are accepted and sent.

## Security Notes

- Access is restricted by `FEISHU_ALLOW_OPEN_IDS` when it is non-empty
- Group chat requires mention when `FEISHU_REQUIRE_MENTION=true` (non-mentioned messages are ignored silently)
- Codex runs with `danger-full-access`; keep strict trigger rules and whitelist

## Docs

- `docs/feishu-setup.md`
- `docs/ops-checklist.md`
- `docs/test-report.md`

