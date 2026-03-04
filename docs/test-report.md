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

## Functional Scenarios

- [ ] Whitelisted DM `/ask ÄãºÃ` gets response
- [ ] Non-whitelisted DM rejected
- [ ] Group message without mention ignored/rejected
- [ ] Group `@bot /ask ...` works
- [ ] `/new` resets memory
- [ ] `/status` shows queue/sandbox/timeout/workdir
- [ ] Duplicate message_id processed once
- [ ] Long answer split into chunks
- [ ] Codex timeout returns retry message

## Feishu Console Validation

- [ ] Long connection selected
- [ ] `im.message.receive_v1` subscribed
- [ ] `im.chat.member.bot.added_v1` subscribed
- [ ] `im.chat.member.bot.deleted_v1` subscribed
- [ ] Required scopes approved

## Notes

-
