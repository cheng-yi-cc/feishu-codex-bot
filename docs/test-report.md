# Test Report

## Metadata

- Date:
- Operator:
- Host:
- Commit/Version:

## Automated Checks

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npx vitest run tests/supervisor.spec.ts tests/config.spec.ts`

## Functional Scenarios

- [ ] Whitelisted DM `/ask ping` gets response
- [ ] Non-whitelisted DM rejected
- [ ] Group message without mention ignored/rejected
- [ ] Group `@bot /ask ...` works
- [ ] `/new` resets memory
- [ ] `/status` shows queue/sandbox/timeout/workdir
- [ ] Duplicate message_id processed once
- [ ] Long answer split into chunks
- [ ] Codex timeout returns retry message
- [ ] `GET /healthz` includes `codexWorkdir`, `logDir`, and `supervisor.restartCount`
- [ ] Missing `CODEX_BIN` fails startup before the app begins monitoring Feishu
- [ ] `start-bot.ps1` builds `dist/index.js` when missing and launches the built app
- [ ] Windows startup task registration succeeds via `scripts/install-startup-task.ps1`

## Feishu Console Validation

- [ ] Long connection selected
- [ ] `im.message.receive_v1` subscribed
- [ ] `im.chat.member.bot.added_v1` subscribed
- [ ] `im.chat.member.bot.deleted_v1` subscribed
- [ ] Required scopes approved

## Notes

-
