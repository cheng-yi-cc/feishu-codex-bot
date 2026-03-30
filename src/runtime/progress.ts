import type { CodexStreamEvent } from "../types/contracts.js";

export function mapCodexEventToProgress(event: CodexStreamEvent): string | null {
  if (event.type === "tool.started") {
    return `\u5904\u7406\u4e2d: ${event.label}`;
  }
  if (event.type === "tool.completed") {
    return `\u5df2\u5b8c\u6210\u6b65\u9aa4: ${event.label}`;
  }
  if (event.type === "turn.completed") {
    return `\u672c\u8f6e\u5b8c\u6210: input=${event.inputTokens ?? 0}, output=${event.outputTokens ?? 0}`;
  }
  return null;
}
