import type * as Lark from "@larksuiteoapi/node-sdk";
import type { Logger } from "pino";
import { createTaskOrchestrator } from "../runtime/orchestrator.js";
import type { RuntimeStore } from "../runtime/types.js";
import type { BotConfig } from "../types/config.js";
import type { CodexRunner } from "../codex/types.js";
import type { IncomingMessage, SessionOptions, SessionStore } from "../types/contracts.js";
import { downloadIncomingAttachment, type DownloadedAttachment } from "../feishu/resources.js";
import { sendFileReply, sendImageReply, sendReplyInChunks } from "../feishu/sender.js";
import { addTypingIndicator, removeTypingIndicator } from "../feishu/typing.js";
import { enforceAccessPolicy } from "./access-control.js";
import { parseCommand } from "./commands.js";
import { resolveIntent } from "./router.js";
import { renderProgressReply, renderResumeReply, renderStatusReply, renderUsageReply } from "./response-renderer.js";
import { SerialTaskQueue } from "./queue.js";

export type RuntimeStatus = {
  startedAt: number;
  lastErrorAt: number | null;
};

type HandlerDeps = {
  config: BotConfig;
  logger: Logger;
  store: SessionStore & RuntimeStore;
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

function createFallbackCodexRunner(
  codexRunner: CodexRunner,
  store: SessionStore,
  config: BotConfig,
  logger: Logger,
): { runner: CodexRunner; getRetryNotice: () => string | undefined } {
  let retryNotice: string | undefined;
  return {
    runner: {
      async run(request) {
        try {
          return await codexRunner.run(request);
        } catch (error) {
          if (!request.model || !isUnsupportedModelError(error)) {
            throw error;
          }

          logger.warn(
            { sessionKey: request.sessionKey, model: request.model },
            "configured model appears unsupported, fallback to default model",
          );
          store.setSessionModel(request.sessionKey, undefined);
          retryNotice = `模型 ${request.model} 不可用，已切回默认模型并重试。`;
          return codexRunner.run({
            ...request,
            model: config.codexDefaultModel,
          });
        }
      },
    },
    getRetryNotice: () => retryNotice,
  };
}

function isResumableTaskStatus(status: string): status is "interrupted" | "resumable" {
  return status === "interrupted" || status === "resumable";
}

function findLatestResumableTask(store: RuntimeStore, sessionKey: string) {
  let limit = 20;

  while (true) {
    const tasks = store.listRecentTasks(sessionKey, limit);
    const match = tasks.find((task) => isResumableTaskStatus(task.status));
    if (match) {
      return match;
    }
    if (tasks.length < limit || limit >= Number.MAX_SAFE_INTEGER) {
      return undefined;
    }

    limit = Math.min(limit * 2, Number.MAX_SAFE_INTEGER);
  }
}

function formatSessionOptionsForUser(options: EffectiveSessionOptions): string[] {
  return [
    `- 模型: ${options.model ?? "codex 默认模型"}`,
    `- 思考等级: ${options.thinkingLevel}`,
  ];
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
    const workspace = store.getWorkspaceState(sessionKey);
    const intent = resolveIntent({
      message,
      command,
      workspaceMode: workspace?.mode ?? "chat",
    });

    if (intent.kind === "reply.status") {
      await sendTextReply(
        deps,
        message,
        renderStatusReply({
          workspace,
          latestTask: workspace?.lastTaskId ? store.getTask(workspace.lastTaskId) : undefined,
          queueLength: queue.getPendingCount(),
          sandboxMode: config.codexSandboxMode,
          timeoutMs: config.codexTimeoutMs,
        }),
      );
      return;
    }

    if (intent.kind === "reply.usage") {
      await sendTextReply(deps, message, renderUsageReply());
      return;
    }

    if (intent.kind === "workspace.resume") {
      const latestTask = findLatestResumableTask(store, sessionKey);
      const events = latestTask ? store.loadTaskEvents(latestTask.id, 10) : [];
      await sendTextReply(deps, message, renderResumeReply(latestTask, events));
      return;
    }

    if (intent.kind === "session.reset") {
      await queue.enqueue(async () => {
        store.resetSession(sessionKey);
        await sendTextReply(deps, message, "已清空当前会话上下文（含模型与思考等级设置）。");
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

    if (intent.kind !== "task.start") {
      logger.info(
        { messageId: message.messageId, commandKind: command.kind, intentKind: intent.kind },
        "message ignored: workspace intent not yet handled in message handler",
      );
      return;
    }

    const normalizedPrompt = buildUserPrompt(message, intent.prompt);
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
      const downloadedAttachments: DownloadedAttachment[] = [];
      try {
        const fallback = createFallbackCodexRunner(codexRunner, store, config, logger);
        const orchestrator = createTaskOrchestrator({
          logger,
          config,
          sessionStore: store,
          runtimeStore: store,
          codexRunner: fallback.runner,
        });
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
        const imagePaths = downloadedAttachments
          .filter((item) => item.type === "image")
          .map((item) => item.localPath);

        logger.info(
          {
            messageId: message.messageId,
            sessionKey,
            taskKind: intent.taskKind,
            imageCount: imagePaths.length,
            attachmentCount: downloadedAttachments.length,
          },
          "starting codex execution",
        );

        const result = await orchestrator.startTask({
          sessionKey,
          chatId: message.chatId,
          prompt: userInput,
          taskKind: intent.taskKind,
          imagePaths,
        });

        const retryNotice = fallback.getRetryNotice();
        if (retryNotice) {
          await sendTextReply(deps, message, retryNotice);
        }

        const taskEvents = store
          .loadTaskEvents(result.taskId, 10)
          .filter((item) => item.phase === "progress");
        for (const event of taskEvents.slice(-3)) {
          await sendTextReply(deps, message, renderProgressReply(event));
        }

        if (result.text) {
          await sendTextReply(deps, message, result.text);
        }
        if (result.directives.length > 0) {
          await sendAssistantDirectives(deps, message, result.directives);
        }

        logger.info(
          {
            messageId: message.messageId,
            sessionKey,
            taskId: result.taskId,
            directives: result.directives.length,
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
