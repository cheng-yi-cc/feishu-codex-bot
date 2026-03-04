# Feishu Open Platform Setup (WebSocket Mode)

## Goal

Configure a Feishu self-built app to work with this bot in `connectionMode=websocket`.

## Required App Permissions

Grant and approve these scopes:

- `im:message`
- `im:message.p2p_msg:readonly`
- `im:message.group_at_msg:readonly`
- `im:message:send_as_bot`
- `im:message.reactions:write_only`
- `获取消息中的资源文件`（Message Resource 下载权限，用于接收用户发来的图片/文件）

## Event Subscription

In **Events & Callbacks**:

1. Choose **Long connection** mode.
2. Add events:
- `im.message.receive_v1`
- `im.chat.member.bot.added_v1`
- `im.chat.member.bot.deleted_v1`
3. Ensure event scopes are approved.

## Bot Visibility

- Publish app to test scope (or production scope).
- Ensure your user account is within app availability scope.

## Runtime Mapping

- `.env` `FEISHU_APP_ID` <- app credentials page
- `.env` `FEISHU_APP_SECRET` <- app credentials page
- `.env` `FEISHU_DOMAIN` <- `feishu` (CN) or `lark` (global)

## Browser Automation Runbook (Playwright MCP)

Use this sequence during interactive setup:

1. Open Feishu Open Platform app console.
2. Pause for user to complete login/2FA.
3. Navigate to permissions page and verify required scopes.
4. Navigate to events page and verify Long connection + required events.
5. Record screenshot and checklist result in `docs/test-report.md`.

If page automation fails due UI changes/captcha, switch to assisted manual mode and continue with this checklist.
