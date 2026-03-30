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

  it("routes bare /ask without attachments to a usage response", () => {
    const message = makeMessage("/ask");
    const command = parseCommand(message, "/ask");
    expect(
      resolveIntent({
        message,
        command,
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.usage" });
  });

  it("routes attachment-only asks to the attachment fallback prompt", () => {
    const message = {
      ...makeMessage(""),
      attachments: [{ type: "image" as const, fileKey: "img_1" }],
    };
    const command = parseCommand(message, "/ask");
    expect(
      resolveIntent({
        message,
        command,
        workspaceMode: "chat",
      }),
    ).toEqual({
      kind: "task.start",
      taskKind: "chat",
      prompt: "请结合我发送的附件给出回答。如果我没有明确问题，请先简要描述内容并询问我下一步需求。",
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

  it("preserves workspace mode semantics across show, reset, set, and invalid inputs", () => {
    expect(
      resolveIntent({
        message: makeMessage("/mode"),
        command: parseCommand(makeMessage("/mode"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.mode", action: "show" });

    expect(
      resolveIntent({
        message: makeMessage("/mode default"),
        command: parseCommand(makeMessage("/mode default"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.mode", action: "reset" });

    expect(
      resolveIntent({
        message: makeMessage("/mode dev"),
        command: parseCommand(makeMessage("/mode dev"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.mode", action: "set", mode: "dev" });

    expect(
      resolveIntent({
        message: makeMessage("/mode purple"),
        command: parseCommand(makeMessage("/mode purple"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.mode", action: "invalid", invalidArg: "purple" });
  });

  it("preserves model and think semantics across show, reset, set, and invalid inputs", () => {
    expect(
      resolveIntent({
        message: makeMessage("/model"),
        command: parseCommand(makeMessage("/model"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.model", action: "show" });

    expect(
      resolveIntent({
        message: makeMessage("/model default"),
        command: parseCommand(makeMessage("/model default"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.model", action: "reset" });

    expect(
      resolveIntent({
        message: makeMessage("/model gpt-5"),
        command: parseCommand(makeMessage("/model gpt-5"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.model", action: "set", model: "gpt-5" });

    expect(
      resolveIntent({
        message: makeMessage("/model <GPT 5>"),
        command: parseCommand(makeMessage("/model <GPT 5>"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.model", action: "invalid", invalidArg: "<GPT 5>" });

    expect(
      resolveIntent({
        message: makeMessage("/think"),
        command: parseCommand(makeMessage("/think"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.think", action: "show" });

    expect(
      resolveIntent({
        message: makeMessage("/think default"),
        command: parseCommand(makeMessage("/think default"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.think", action: "reset" });

    expect(
      resolveIntent({
        message: makeMessage("/think high"),
        command: parseCommand(makeMessage("/think high"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.think", action: "set", level: "high" });

    expect(
      resolveIntent({
        message: makeMessage("/think <ultra>"),
        command: parseCommand(makeMessage("/think <ultra>"), "/ask"),
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "reply.think", action: "invalid", invalidArg: "<ultra>" });
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
