import type { CodexPromptParams } from "./types.js";

function formatHistoryLine(index: number, role: "user" | "assistant", content: string): string {
  const safe = content.replace(/\r?\n/g, "\\n").trim();
  return `${index}. [${role}] ${safe}`;
}

export function buildPrompt(params: CodexPromptParams): string {
  const { sessionKey, history } = params;
  const lines = history.map((item, index) => formatHistoryLine(index + 1, item.role, item.content));

  return [
    "You are the Codex assistant responding inside a Feishu chat bot.",
    "Default response language: Chinese. If the user explicitly requests another language, follow that request.",
    "Keep answers concise and actionable.",
    "If you need to send an image or file back to user, append directives exactly like:",
    '<send_image path="relative/or/absolute/path/inside/workdir.png" />',
    '<send_file path="relative/or/absolute/path/inside/workdir.ext" />',
    "Only use existing local file paths under current workdir.",
    `Session key: ${sessionKey}`,
    "Conversation transcript (oldest to newest):",
    lines.length > 0 ? lines.join("\n") : "(empty)",
    "Reply to the latest user message in context.",
  ].join("\n\n");
}
