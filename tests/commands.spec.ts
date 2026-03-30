import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/bot/commands.js";
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

describe("parseCommand", () => {
  it("parses explicit ask command", () => {
    const command = parseCommand(makeMessage("/ask hello"), "/ask");
    expect(command).toEqual({ kind: "ask", prompt: "hello" });
  });

  it("treats plain text as ask", () => {
    const command = parseCommand(makeMessage("hello codex"), "/ask");
    expect(command).toEqual({ kind: "ask", prompt: "hello codex" });
  });

  it("ignores unknown slash commands", () => {
    const command = parseCommand(makeMessage("/help"), "/ask");
    expect(command).toEqual({ kind: "none" });
  });

  it("parses model and think commands", () => {
    expect(parseCommand(makeMessage("/model gpt-5"), "/ask")).toEqual({
      kind: "model",
      model: "gpt-5",
    });
    expect(parseCommand(makeMessage("/model <gpt-5>"), "/ask")).toEqual({
      kind: "model",
      model: "gpt-5",
    });
    expect(parseCommand(makeMessage("/model 《gpt-5》"), "/ask")).toEqual({
      kind: "model",
      model: "gpt-5",
    });
    expect(parseCommand(makeMessage("/think high"), "/ask")).toEqual({
      kind: "think",
      level: "high",
    });
    expect(parseCommand(makeMessage("/think <high>"), "/ask")).toEqual({
      kind: "think",
      level: "high",
    });
  });

  it("parses the expanded workspace commands", () => {
    expect(parseCommand(makeMessage("/mode dev"), "/ask")).toEqual({ kind: "mode", mode: "dev" });
    expect(parseCommand(makeMessage("/resume"), "/ask")).toEqual({ kind: "resume" });
    expect(parseCommand(makeMessage("/cwd D:\\My Project\\feishu-codex-bot"), "/ask")).toEqual({
      kind: "cwd",
      path: "D:\\My Project\\feishu-codex-bot",
    });
    expect(parseCommand(makeMessage("/run npm test"), "/ask")).toEqual({
      kind: "run",
      command: "npm test",
    });
    expect(parseCommand(makeMessage("/abort"), "/ask")).toEqual({ kind: "abort" });
  });

  it("returns invalid for malformed model command", () => {
    expect(parseCommand(makeMessage("/model <GPT 5>"), "/ask")).toEqual({
      kind: "model",
      invalidArg: "<GPT 5>",
    });
  });

  it("treats attachment-only message as ask", () => {
    const command = parseCommand(
      {
        ...makeMessage(""),
        messageType: "image",
        attachments: [{ type: "image", fileKey: "img_x" }],
      },
      "/ask",
    );
    expect(command).toEqual({ kind: "ask", prompt: "" });
  });
});
