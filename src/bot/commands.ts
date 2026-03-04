import type { IncomingMessage } from "../types/contracts.js";

export type ParsedCommand =
  | { kind: "ask"; prompt: string }
  | { kind: "new" }
  | { kind: "status" }
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
