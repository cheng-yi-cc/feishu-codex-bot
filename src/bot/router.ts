import type { IncomingMessage } from "../types/contracts.js";
import type { ParsedCommand } from "./commands.js";
import type { UserIntent, WorkspaceMode } from "../runtime/types.js";

const ATTACHMENT_ONLY_PROMPT =
  "请结合我发送的附件给出回答。如果我没有明确问题，请先简要描述内容并询问我下一步需求。";

function buildAskPrompt(message: IncomingMessage, prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (message.attachments.length > 0) {
    return ATTACHMENT_ONLY_PROMPT;
  }
  return "";
}

function resolveAskIntent(message: IncomingMessage, prompt: string, workspaceMode: WorkspaceMode): UserIntent {
  const resolvedPrompt = buildAskPrompt(message, prompt);
  if (resolvedPrompt.length === 0) {
    return { kind: "reply.usage" };
  }
  return {
    kind: "task.start",
    taskKind: workspaceMode === "dev" ? "dev" : "chat",
    prompt: resolvedPrompt,
  };
}

function toModeIntent(command: Extract<ParsedCommand, { kind: "mode" }>): Extract<UserIntent, { kind: "workspace.mode" }> {
  return command.action === "set"
    ? { kind: "workspace.mode", action: command.action, mode: command.mode }
    : command.action === "invalid"
      ? { kind: "workspace.mode", action: command.action, invalidArg: command.invalidArg }
      : { kind: "workspace.mode", action: command.action };
}

function toModelIntent(command: Extract<ParsedCommand, { kind: "model" }>): Extract<UserIntent, { kind: "reply.model" }> {
  return command.action === "set"
    ? { kind: "reply.model", action: command.action, model: command.model }
    : command.action === "invalid"
      ? { kind: "reply.model", action: command.action, invalidArg: command.invalidArg }
      : { kind: "reply.model", action: command.action };
}

function toThinkIntent(command: Extract<ParsedCommand, { kind: "think" }>): Extract<UserIntent, { kind: "reply.think" }> {
  return command.action === "set"
    ? { kind: "reply.think", action: command.action, level: command.level }
    : command.action === "invalid"
      ? { kind: "reply.think", action: command.action, invalidArg: command.invalidArg }
      : { kind: "reply.think", action: command.action };
}

export function resolveIntent(input: {
  message: IncomingMessage;
  command: ParsedCommand;
  workspaceMode: WorkspaceMode;
}): UserIntent {
  const { command, workspaceMode } = input;

  if (command.kind === "none") return { kind: "noop" };
  if (command.kind === "new") return { kind: "session.reset" };
  if (command.kind === "status") return { kind: "reply.status" };
  if (command.kind === "resume") return { kind: "workspace.resume" };
  if (command.kind === "mode") return toModeIntent(command);
  if (command.kind === "cwd") return { kind: "workspace.cwd", path: command.path };
  if (command.kind === "run") return { kind: "workspace.command", command: "run", value: command.command };
  if (command.kind === "test") return { kind: "workspace.command", command: "test", value: command.target };
  if (command.kind === "diff") return { kind: "workspace.command", command: "diff" };
  if (command.kind === "files") return { kind: "workspace.command", command: "files" };
  if (command.kind === "logs") return { kind: "workspace.command", command: "logs" };
  if (command.kind === "branch") return { kind: "workspace.command", command: "branch", value: command.name };
  if (command.kind === "apply") return { kind: "workspace.command", command: "apply" };
  if (command.kind === "abort") return { kind: "workspace.command", command: "abort" };
  if (command.kind === "model") return toModelIntent(command);
  if (command.kind === "think") return toThinkIntent(command);
  if (command.kind === "ask") {
    return resolveAskIntent(input.message, command.prompt, workspaceMode);
  }

  return { kind: "noop" };
}
