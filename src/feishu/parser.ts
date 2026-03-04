import type { IncomingMessage } from "../types/contracts.js";
import type { FeishuEventEnvelope, FeishuMessageReceiveEvent } from "./events.js";

function parseTextContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    if (messageType === "text") {
      return typeof parsed.text === "string" ? parsed.text : "";
    }
    if (messageType === "post") {
      const blocks = parsed.content as Array<Array<{ tag?: string; text?: string }>> | undefined;
      if (!Array.isArray(blocks)) return "";
      const lines = blocks.map((paragraph) =>
        paragraph
          .map((item) => (item.tag === "text" || item.tag === "a" ? item.text ?? "" : ""))
          .join(""),
      );
      return lines.filter(Boolean).join("\n");
    }
  } catch {
    return content;
  }
  return "";
}

function stripMentions(text: string, event: FeishuMessageReceiveEvent): string {
  const mentions = event.message.mentions ?? [];
  let cleaned = text;
  for (const mention of mentions) {
    if (mention.key) {
      cleaned = cleaned.replaceAll(mention.key, "");
    }
    if (mention.name) {
      cleaned = cleaned.replaceAll(`@${mention.name}`, "");
    }
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function parseAttachments(event: FeishuMessageReceiveEvent) {
  const messageType = event.message.message_type;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.message.content);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const payload = parsed as {
    image_key?: unknown;
    file_key?: unknown;
    file_name?: unknown;
  };

  if (messageType === "image" && typeof payload.image_key === "string") {
    return [
      {
        type: "image" as const,
        fileKey: payload.image_key,
      },
    ];
  }

  if (messageType === "file" && typeof payload.file_key === "string") {
    return [
      {
        type: "file" as const,
        fileKey: payload.file_key,
        fileName: typeof payload.file_name === "string" ? payload.file_name : undefined,
      },
    ];
  }

  return [];
}

export function parseIncomingMessage(
  payload: FeishuEventEnvelope<FeishuMessageReceiveEvent> | FeishuMessageReceiveEvent,
  botOpenId: string,
): IncomingMessage | null {
  const maybeEnvelope = payload as FeishuEventEnvelope<FeishuMessageReceiveEvent>;
  const event = maybeEnvelope.event ?? (payload as FeishuMessageReceiveEvent);
  if (!event?.message?.message_id || !event.message.chat_id) {
    return null;
  }

  const senderOpenId = event.sender.sender_id.open_id;
  if (!senderOpenId) {
    return null;
  }

  const mentions = event.message.mentions ?? [];
  const mentionedBot = mentions.some((m) => m.id.open_id === botOpenId || m.id.user_id === botOpenId);

  const rawText = parseTextContent(event.message.content, event.message.message_type);
  const text = stripMentions(rawText, event);
  const attachments = parseAttachments(event);

  return {
    messageId: event.message.message_id,
    chatId: event.message.chat_id,
    chatType: event.message.chat_type,
    senderOpenId,
    messageType: event.message.message_type,
    text,
    mentionedBot,
    attachments,
  };
}
