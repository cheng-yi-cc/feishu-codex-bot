import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/bot/commands.js";
import { resolveIntent } from "../src/bot/router.js";
import type { IncomingMessage } from "../src/types/contracts.js";

function makeMessage(text: string, chatType: "p2p" | "group" = "p2p"): IncomingMessage {
  return {
    messageId: "m1",
    chatId: "oc_1",
    chatType,
    senderOpenId: "ou_1",
    messageType: "text",
    text,
    mentionedBot: chatType === "group",
    attachments: [],
  };
}

describe("resolveIntent", () => {
  it("routes plain text to a dev task when workspace mode is dev", () => {
    const command = parseCommand(makeMessage("修复启动失败"), "/ask");
    expect(
      resolveIntent({
        message: makeMessage("修复启动失败"),
        command,
        workspaceMode: "dev",
      }),
    ).toEqual({
      kind: "task.start",
      taskKind: "dev",
      prompt: "修复启动失败",
    });
  });

  it("routes /resume to a workspace resume intent", () => {
    const command = parseCommand(makeMessage("/resume"), "/ask");
    expect(
      resolveIntent({
        message: makeMessage("/resume"),
        command,
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.resume" });
  });

  it("routes /cwd to a workspace cwd intent", () => {
    const command = parseCommand(makeMessage("/cwd D:\\My Project\\feishu-codex-bot"), "/ask");
    expect(
      resolveIntent({
        message: makeMessage("/cwd D:\\My Project\\feishu-codex-bot"),
        command,
        workspaceMode: "chat",
      }),
    ).toEqual({
      kind: "workspace.cwd",
      path: "D:\\My Project\\feishu-codex-bot",
    });
  });
});
