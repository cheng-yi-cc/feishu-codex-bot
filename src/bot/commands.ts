import type { IncomingMessage } from "../types/contracts.js";
import type { WorkspaceMode } from "../runtime/types.js";

export type ParsedCommand =
  | { kind: "ask"; prompt: string }
  | { kind: "new" }
  | { kind: "status" }
  | { kind: "resume" }
  | { kind: "mode"; mode?: WorkspaceMode; reset?: boolean; invalidArg?: string }
  | { kind: "cwd"; path?: string }
  | { kind: "run"; command?: string }
  | { kind: "test"; target?: string }
  | { kind: "diff" }
  | { kind: "files" }
  | { kind: "logs" }
  | { kind: "branch"; name?: string }
  | { kind: "apply" }
  | { kind: "abort" }
  | { kind: "model"; model?: string; reset?: boolean; invalidArg?: string }
  | { kind: "think"; level?: "low" | "medium" | "high"; reset?: boolean; invalidArg?: string }
  | { kind: "none" };

function unwrapAngleArg(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:<|＜|《)\s*([^>＞》]+?)\s*(?:>|＞|》)$/);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

function normalizeModelArg(raw: string): string {
  return unwrapAngleArg(raw).replace(/^["'`]+|["'`]+$/g, "").trim();
}

function isLikelyModelName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function parseModeArg(raw: string): Pick<Extract<ParsedCommand, { kind: "mode" }>, "mode" | "reset" | "invalidArg"> {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return {};
  }
  if (value === "default") {
    return { reset: true };
  }
  if (value === "chat" || value === "dev") {
    return { mode: value };
  }
  return { invalidArg: raw };
}

export function parseCommand(message: IncomingMessage, prefix: "/ask"): ParsedCommand {
  const text = message.text.trim();
  if (!text && message.attachments.length === 0) {
    return { kind: "none" };
  }

  if (text === "/new") {
    return { kind: "new" };
  }

  if (text === "/status") {
    return { kind: "status" };
  }

  if (text === "/resume") {
    return { kind: "resume" };
  }

  if (text === "/mode") {
    return { kind: "mode" };
  }
  if (text.startsWith("/mode ")) {
    const rawValue = text.slice("/mode ".length).trim();
    const parsed = parseModeArg(rawValue);
    return { kind: "mode", ...parsed };
  }

  if (text === "/cwd") {
    return { kind: "cwd" };
  }
  if (text.startsWith("/cwd ")) {
    const path = text.slice("/cwd ".length).trim();
    return path ? { kind: "cwd", path } : { kind: "cwd" };
  }

  if (text === "/run") {
    return { kind: "run" };
  }
  if (text.startsWith("/run ")) {
    const command = text.slice("/run ".length).trim();
    return command ? { kind: "run", command } : { kind: "run" };
  }

  if (text === "/test") {
    return { kind: "test" };
  }
  if (text.startsWith("/test ")) {
    const target = text.slice("/test ".length).trim();
    return target ? { kind: "test", target } : { kind: "test" };
  }

  if (text === "/diff") {
    return { kind: "diff" };
  }

  if (text === "/files") {
    return { kind: "files" };
  }

  if (text === "/logs") {
    return { kind: "logs" };
  }

  if (text === "/branch") {
    return { kind: "branch" };
  }
  if (text.startsWith("/branch ")) {
    const name = text.slice("/branch ".length).trim();
    return name ? { kind: "branch", name } : { kind: "branch" };
  }

  if (text === "/apply") {
    return { kind: "apply" };
  }

  if (text === "/abort") {
    return { kind: "abort" };
  }

  if (text === "/model") {
    return { kind: "model" };
  }
  if (text.startsWith("/model ")) {
    const rawValue = text.slice("/model ".length).trim();
    const value = normalizeModelArg(rawValue);
    if (!value) {
      return { kind: "model" };
    }
    if (value.toLowerCase() === "default") {
      return { kind: "model", reset: true };
    }
    if (!isLikelyModelName(value)) {
      return { kind: "model", invalidArg: rawValue };
    }
    return { kind: "model", model: value };
  }

  if (text === "/think") {
    return { kind: "think" };
  }
  if (text.startsWith("/think ")) {
    const rawValue = text.slice("/think ".length).trim();
    const value = unwrapAngleArg(rawValue).toLowerCase();
    if (!value) {
      return { kind: "think" };
    }
    if (value === "default") {
      return { kind: "think", reset: true };
    }
    if (value === "low" || value === "medium" || value === "high") {
      return { kind: "think", level: value };
    }
    return { kind: "think", invalidArg: rawValue };
  }

  if (text === prefix) {
    return { kind: "ask", prompt: "" };
  }

  if (text.startsWith(`${prefix} `)) {
    return { kind: "ask", prompt: text.slice(prefix.length).trim() };
  }

  if (text.startsWith("/")) {
    return { kind: "none" };
  }

  if (!text && message.attachments.length > 0) {
    return { kind: "ask", prompt: "" };
  }

  return { kind: "ask", prompt: text };
}
