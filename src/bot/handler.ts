import type * as Lark from "@larksuiteoapi/node-sdk";
import type { Logger } from "pino";
import type { BotConfig } from "../types/config.js";
import type { CodexRunner } from "../codex/types.js";
import type { IncomingMessage, SessionOptions, SessionStore } from "../types/contracts.js";
import { buildPrompt } from "../codex/prompt-builder.js";
import { parseAssistantResponse } from "../codex/response-parser.js";
import { downloadIncomingAttachment, type DownloadedAttachment } from "../feishu/resources.js";
import { sendFileReply, sendImageReply, sendReplyInChunks } from "../feishu/sender.js";
import { addTypingIndicator, removeTypingIndicator } from "../feishu/typing.js";
import { enforceAccessPolicy } from "./access-control.js";
import { parseCommand } from "./commands.js";
import { SerialTaskQueue } from "./queue.js";

export type RuntimeStatus = {
  startedAt: number;
  lastErrorAt: number | null;
};

type HandlerDeps = {
  config: BotConfig;
  logger: Logger;
  store: SessionStore;
  codexRunner: CodexRunner;
  queue: SerialTaskQueue;
  feishuClient: Lark.Client;
  runtimeStatus: RuntimeStatus;
};

type EffectiveSessionOptions = {
  model?: string;
  thinkingLevel: "low" | "medium" | "high";
};

function sessionKeyForMessage(message: IncomingMessage): string {
  if (message.chatType === "p2p") {
    return `dm:${message.senderOpenId}`;
  }
  return `group:${message.chatId}`;
}

function resolveEffectiveSessionOptions(
  config: BotConfig,
  sessionOptions: SessionOptions,
): EffectiveSessionOptions {
  return {
    model: sessionOptions.model ?? config.codexDefaultModel,
    thinkingLevel: sessionOptions.thinkingLevel ?? config.codexDefaultThinkingLevel,
  };
}

function isUnsupportedModelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("model is not supported") ||
    text.includes("model metadata") ||
    text.includes("unknown model")
  );
}

function formatSessionOptionsForUser(options: EffectiveSessionOptions): string[] {
  return [
    `- 模型: ${options.model ?? "codex 默认模型"}`,
    `- 思考等级: ${options.thinkingLevel}`,
  ];
}

function buildStatusText(
  config: BotConfig,
  queue: SerialTaskQueue,
  runtimeStatus: RuntimeStatus,
  options: EffectiveSessionOptions,
): string {
  const lines = [
    "机器人状态",
    `- 连接模式: websocket`,
    `- 队列长度: ${queue.getPendingCount()}`,
    `- 沙箱策略: ${config.codexSandboxMode}`,
    `- 超时: ${config.codexTimeoutMs}ms`,
    `- 历史轮数: ${config.codexHistoryTurns}`,
    `- 工作目录: ${config.codexWorkdir}`,
    ...formatSessionOptionsForUser(options),
    `- 最近错误: ${runtimeStatus.lastErrorAt ? new Date(runtimeStatus.lastErrorAt).toISOString() : "none"}`,
  ];
  return lines.join("\n");
}

function summarizeAttachmentsForPrompt(attachments: DownloadedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const lines = attachments.map(
    (item, index) => `${index + 1}. type=${item.type}, name=${item.fileName}, path=${item.localPath}`,
  );
  return `用户附件（已下载到本地，可直接读取路径）:\n${lines.join("\n")}`;
}

function buildUserPrompt(message: IncomingMessage, prompt: string): string {
  if (prompt.trim().length > 0) {
    return prompt.trim();
  }
  if (message.attachments.length > 0) {
    return "请结合我发送的附件给出回答。如果我没有明确问题，请先简要描述内容并询问我下一步需求。";
  }
  return "";
}

function summarizeAssistantReplyForHistory(text: string, directivesCount: number): string {
  const lines = [text.trim()];
  if (directivesCount > 0) {
    lines.push(`[assistant_sent_attachments]: ${directivesCount}`);
  }
  return lines.filter(Boolean).join("\n");
}

async function sendTextReply(deps: HandlerDeps, message: IncomingMessage, text: string): Promise<void> {
  await sendReplyInChunks({
    client: deps.feishuClient,
    logger: deps.logger,
    chatId: message.chatId,
    chatType: message.chatType,
    replyToMessageId: message.messageId,
    text,
    maxChunkChars: deps.config.replyChunkChars,
  });
}

async function sendAssistantDirectives(
  deps: HandlerDeps,
  message: IncomingMessage,
  directives: Array<{ type: "image" | "file"; path: string }>,
): Promise<void> {
  for (const directive of directives) {
    if (directive.type === "image") {
      await sendImageReply({
        client: deps.feishuClient,
        logger: deps.logger,
        chatId: message.chatId,
        chatType: message.chatType,
        replyToMessageId: message.messageId,
        localPath: directive.path,
      });
      continue;
    }

    await sendFileReply({
      client: deps.feishuClient,
      logger: deps.logger,
      chatId: message.chatId,
      chatType: message.chatType,
      replyToMessageId: message.messageId,
      localPath: directive.path,
    });
  }
}

export function createMessageHandler(deps: HandlerDeps) {
  const { config, logger, store, codexRunner, queue, runtimeStatus } = deps;

  return async function handleMessage(message: IncomingMessage): Promise<void> {
    if (store.isDuplicate(message.messageId)) {
      logger.debug({ messageId: message.messageId }, "skip duplicate message");
      return;
    }

    const command = parseCommand(message, config.feishuTriggerPrefix);
    if (command.kind === "none") {
      logger.info(
        {
          messageId: message.messageId,
          chatType: message.chatType,
          mentionedBot: message.mentionedBot,
        },
        "message ignored: no supported command",
      );
      return;
    }

    const access = enforceAccessPolicy(config, message);
    if (!access.allowed) {
      logger.info(
        {
          messageId: message.messageId,
          senderOpenId: message.senderOpenId,
          reason: access.reason,
          notify: access.notify ?? true,
        },
        "message denied by access policy",
      );
      if (access.notify !== false) {
        await sendTextReply(deps, message, access.reason ?? "未授权");
      }
      return;
    }

    const sessionKey = sessionKeyForMessage(message);

    if (command.kind === "new") {
      await queue.enqueue(async () => {
        store.resetSession(sessionKey);
        await sendTextReply(deps, message, "已清空当前会话上下文（含模型与思考等级设置）。");
      });
      return;
    }

    if (command.kind === "status") {
      await queue.enqueue(async () => {
        const options = resolveEffectiveSessionOptions(config, store.getSessionOptions(sessionKey));
        await sendTextReply(deps, message, buildStatusText(config, queue, runtimeStatus, options));
      });
      return;
    }

    if (command.kind === "model") {
      await queue.enqueue(async () => {
        let title = "当前模型设置：";
        if (command.reset) {
          store.setSessionModel(sessionKey, undefined);
          title = "模型已恢复默认。";
        } else if (command.model) {
          store.setSessionModel(sessionKey, command.model);
          title = `模型已设置为 ${command.model}。`;
        } else if (command.invalidArg) {
          title = `无效模型参数: ${command.invalidArg}`;
        }
        const options = resolveEffectiveSessionOptions(config, store.getSessionOptions(sessionKey));
        const hint = [
          title,
          ...formatSessionOptionsForUser(options),
          "用法: /model <模型名> | /model default | /model",
        ].join("\n");
        await sendTextReply(deps, message, hint);
      });
      return;
    }

    if (command.kind === "think") {
      await queue.enqueue(async () => {
        let title = "当前思考等级：";
        if (command.reset) {
          store.setSessionThinkingLevel(sessionKey, undefined);
          title = "思考等级已恢复默认。";
        } else if (command.level) {
          store.setSessionThinkingLevel(sessionKey, command.level);
          title = `思考等级已设置为 ${command.level}。`;
        } else if (command.invalidArg) {
          title = `无效思考等级参数: ${command.invalidArg}`;
        }
        const options = resolveEffectiveSessionOptions(config, store.getSessionOptions(sessionKey));
        const hint = [
          title,
          ...formatSessionOptionsForUser(options),
          "用法: /think <low|medium|high> | /think default | /think",
        ].join("\n");
        await sendTextReply(deps, message, hint);
      });
      return;
    }

    if (command.kind !== "ask") {
      logger.info(
        { messageId: message.messageId, commandKind: command.kind },
        "message ignored: workspace intent not yet handled in message handler",
      );
      return;
    }

    const normalizedPrompt = buildUserPrompt(message, command.prompt);
    if (!normalizedPrompt) {
      logger.info({ messageId: message.messageId }, "ask command missing prompt");
      await sendTextReply(deps, message, "用法: /ask 你的问题");
      return;
    }

    const typingState = await addTypingIndicator({
      client: deps.feishuClient,
      logger,
      messageId: message.messageId,
    });

    await queue.enqueue(async () => {
      let downloadedAttachments: DownloadedAttachment[] = [];
      try {
        for (const attachment of message.attachments) {
          const local = await downloadIncomingAttachment({
            client: deps.feishuClient,
            workdir: config.codexWorkdir,
            sessionKey,
            messageId: message.messageId,
            attachment,
          });
          downloadedAttachments.push(local);
        }

        const attachmentSummary = summarizeAttachmentsForPrompt(downloadedAttachments);
        const userInput = [normalizedPrompt, attachmentSummary].filter(Boolean).join("\n\n");

        store.appendUser(sessionKey, userInput);
        const history = store.loadRecent(sessionKey, config.codexHistoryTurns);
        const prompt = buildPrompt({ sessionKey, history });
        const options = resolveEffectiveSessionOptions(config, store.getSessionOptions(sessionKey));
        const imagePaths = downloadedAttachments
          .filter((item) => item.type === "image")
          .map((item) => item.localPath);

        logger.info(
          {
            messageId: message.messageId,
            sessionKey,
            model: options.model,
            thinkingLevel: options.thinkingLevel,
            imageCount: imagePaths.length,
            attachmentCount: downloadedAttachments.length,
          },
          "starting codex execution",
        );

        let retryNotice: string | null = null;
        let result;
        try {
          result = await codexRunner.run({
            sessionKey,
            prompt,
            workdir: config.codexWorkdir,
            timeoutMs: config.codexTimeoutMs,
            model: options.model,
            reasoningEffort: options.thinkingLevel,
            imagePaths,
          });
        } catch (firstError) {
          if (!options.model || !isUnsupportedModelError(firstError)) {
            throw firstError;
          }

          logger.warn(
            { messageId: message.messageId, sessionKey, model: options.model },
            "configured model appears unsupported, fallback to default model",
          );
          store.setSessionModel(sessionKey, undefined);
          const fallback = resolveEffectiveSessionOptions(config, store.getSessionOptions(sessionKey));
          retryNotice = `模型 ${options.model} 当前不可用，已自动切回默认模型 ${fallback.model ?? "codex 默认模型"}。`;
          result = await codexRunner.run({
            sessionKey,
            prompt,
            workdir: config.codexWorkdir,
            timeoutMs: config.codexTimeoutMs,
            model: fallback.model,
            reasoningEffort: fallback.thinkingLevel,
            imagePaths,
          });
        }

        const parsed = parseAssistantResponse(result.answer, config.codexWorkdir);
        const historyReply = summarizeAssistantReplyForHistory(parsed.text, parsed.directives.length);
        store.appendAssistant(sessionKey, historyReply || result.answer);

        if (retryNotice) {
          await sendTextReply(deps, message, retryNotice);
        }
        if (parsed.text) {
          await sendTextReply(deps, message, parsed.text);
        }
        if (parsed.directives.length > 0) {
          await sendAssistantDirectives(deps, message, parsed.directives);
        }
        if (!parsed.text && parsed.directives.length === 0) {
          await sendTextReply(deps, message, result.answer);
        }

        logger.info(
          {
            messageId: message.messageId,
            sessionKey,
            durationMs: result.durationMs,
            usage: result.usage,
            directives: parsed.directives.length,
          },
          "codex reply dispatched",
        );
      } catch (error) {
        runtimeStatus.lastErrorAt = Date.now();
        logger.error({ err: error, messageId: message.messageId }, "codex execution failed");
        await sendTextReply(
          deps,
          message,
          "执行失败或超时，请稍后重试。若持续失败，请联系管理员查看日志。",
        );
      } finally {
        await removeTypingIndicator({
          client: deps.feishuClient,
          logger,
          state: typingState,
        });
      }
    });
  };
}
