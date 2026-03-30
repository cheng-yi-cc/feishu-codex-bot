import type { IncomingMessage } from "../types/contracts.js";
import type { ParsedCommand } from "./commands.js";
import type { UserIntent, WorkspaceMode } from "../runtime/types.js";

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
  if (command.kind === "mode") return { kind: "workspace.mode", mode: command.reset ? undefined : command.mode };
  if (command.kind === "cwd") return { kind: "workspace.cwd", path: command.path };
  if (command.kind === "run") return { kind: "workspace.command", command: "run", value: command.command };
  if (command.kind === "test") return { kind: "workspace.command", command: "test", value: command.target };
  if (command.kind === "diff") return { kind: "workspace.command", command: "diff" };
  if (command.kind === "files") return { kind: "workspace.command", command: "files" };
  if (command.kind === "logs") return { kind: "workspace.command", command: "logs" };
  if (command.kind === "branch") return { kind: "workspace.command", command: "branch", value: command.name };
  if (command.kind === "apply") return { kind: "workspace.command", command: "apply" };
  if (command.kind === "abort") return { kind: "workspace.command", command: "abort" };
  if (command.kind === "model") return { kind: "reply.model" };
  if (command.kind === "think") return { kind: "reply.think" };

  return {
    kind: "task.start",
    taskKind: workspaceMode === "dev" ? "dev" : "chat",
    prompt: command.prompt,
  };
}
