import fs from "node:fs";
import path from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { IncomingAttachment } from "../types/contracts.js";

export type DownloadedAttachment = {
  type: "image" | "file";
  fileKey: string;
  fileName: string;
  localPath: string;
};

type DownloadAttachmentOptions = {
  client: Lark.Client;
  workdir: string;
  sessionKey: string;
  messageId: string;
  attachment: IncomingAttachment;
};

function sanitizePathPart(input: string): string {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function sanitizeFileName(input: string): string {
  const base = sanitizePathPart(input).trim();
  return base.length > 0 ? base : "attachment.bin";
}

function defaultNameForAttachment(attachment: IncomingAttachment): string {
  const suffix = attachment.fileKey.slice(0, 10);
  if (attachment.type === "image") {
    return `image_${suffix}.png`;
  }
  return `file_${suffix}.bin`;
}

export async function downloadIncomingAttachment(
  options: DownloadAttachmentOptions,
): Promise<DownloadedAttachment> {
  const { client, workdir, sessionKey, messageId, attachment } = options;
  const sessionDir = path.join(workdir, "attachments", sanitizePathPart(sessionKey));
  fs.mkdirSync(sessionDir, { recursive: true });

  const sourceName = attachment.fileName ?? defaultNameForAttachment(attachment);
  const fileName = sanitizeFileName(sourceName);
  const localPath = path.join(sessionDir, `${Date.now()}_${fileName}`);

  const response = await client.im.messageResource.get({
    params: { type: attachment.type },
    path: {
      message_id: messageId,
      file_key: attachment.fileKey,
    },
  });

  await response.writeFile(localPath);
  return {
    type: attachment.type,
    fileKey: attachment.fileKey,
    fileName,
    localPath,
  };
}
