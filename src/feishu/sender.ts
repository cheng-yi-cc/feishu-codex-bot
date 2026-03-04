import fs from "node:fs";
import path from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { Logger } from "pino";

type SendReplyOptions = {
  client: Lark.Client;
  logger: Logger;
  chatId: string;
  chatType: "p2p" | "group";
  replyToMessageId: string;
  text: string;
  maxChunkChars: number;
};

type SendBinaryReplyOptions = {
  client: Lark.Client;
  logger: Logger;
  chatId: string;
  chatType: "p2p" | "group";
  replyToMessageId: string;
  localPath: string;
};

function chunkText(content: string, maxChunkChars: number): string[] {
  if (content.length <= maxChunkChars) {
    return [content];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    chunks.push(content.slice(start, start + maxChunkChars));
    start += maxChunkChars;
  }
  return chunks;
}

export async function sendReplyInChunks(options: SendReplyOptions): Promise<void> {
  const { client, logger, chatId, chatType, replyToMessageId, text, maxChunkChars } = options;
  const chunks = chunkText(text, maxChunkChars).filter(Boolean);
  for (const chunk of chunks) {
    const content = JSON.stringify({ text: chunk });
    await sendMessage(options, "text", content);
  }
}

function fileTypeFromPath(localPath: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const ext = path.extname(localPath).toLowerCase();
  if (ext === ".opus" || ext === ".ogg" || ext === ".mp3" || ext === ".wav" || ext === ".m4a") {
    return "opus";
  }
  if (ext === ".mp4") {
    return "mp4";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if (ext === ".doc" || ext === ".docx" || ext === ".txt" || ext === ".md") {
    return "doc";
  }
  if (ext === ".xls" || ext === ".xlsx" || ext === ".csv") {
    return "xls";
  }
  if (ext === ".ppt" || ext === ".pptx") {
    return "ppt";
  }
  return "stream";
}

async function sendMessage(
  options: Pick<SendReplyOptions, "client" | "logger" | "chatId" | "chatType" | "replyToMessageId">,
  msgType: string,
  content: string,
): Promise<void> {
  const { client, logger, chatId, chatType, replyToMessageId } = options;
  if (chatType === "p2p") {
    const direct = (await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: msgType,
        content,
      },
    })) as { code?: number; msg?: string };
    if (direct.code !== 0) {
      throw new Error(`failed to send p2p message: ${direct.msg ?? `code ${direct.code}`}`);
    }
    return;
  }

  const response = (await client.im.message.reply({
    path: { message_id: replyToMessageId },
    data: {
      msg_type: msgType,
      content,
    },
  })) as { code?: number; msg?: string };

  if (response.code !== 0) {
    logger.warn({ code: response.code, msg: response.msg }, "reply failed, fallback to create");
    const fallback = (await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: msgType,
        content,
      },
    })) as { code?: number; msg?: string };
    if (fallback.code !== 0) {
      throw new Error(`failed to send group message: ${fallback.msg ?? `code ${fallback.code}`}`);
    }
  }
}

export async function sendImageReply(options: SendBinaryReplyOptions): Promise<void> {
  const { client, localPath } = options;
  const upload = (await client.im.image.create({
    data: {
      image_type: "message",
      image: fs.createReadStream(localPath),
    },
  })) as { image_key?: string } | null;

  const imageKey = upload?.image_key;
  if (!imageKey) {
    throw new Error("failed to upload image: image_key missing");
  }

  await sendMessage(options, "image", JSON.stringify({ image_key: imageKey }));
}

export async function sendFileReply(options: SendBinaryReplyOptions): Promise<void> {
  const { client, localPath } = options;
  const upload = (await client.im.file.create({
    data: {
      file_type: fileTypeFromPath(localPath),
      file_name: path.basename(localPath),
      file: fs.createReadStream(localPath),
    },
  })) as { file_key?: string } | null;

  const fileKey = upload?.file_key;
  if (!fileKey) {
    throw new Error("failed to upload file: file_key missing");
  }

  await sendMessage(options, "file", JSON.stringify({ file_key: fileKey }));
}
