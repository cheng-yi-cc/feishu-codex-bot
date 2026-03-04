import * as Lark from "@larksuiteoapi/node-sdk";
import type { Logger } from "pino";
import type { BotConfig } from "../types/config.js";
import type { IncomingMessage } from "../types/contracts.js";
import type { FeishuEventEnvelope, FeishuMessageReceiveEvent } from "./events.js";
import { createFeishuWsClient } from "./client.js";
import { parseIncomingMessage } from "./parser.js";

type MonitorOptions = {
  config: BotConfig;
  logger: Logger;
  botOpenId: string;
  onMessage: (message: IncomingMessage) => Promise<void>;
};

export type FeishuMonitorHandle = {
  stop: () => void;
};

export function startFeishuMonitor(options: MonitorOptions): FeishuMonitorHandle {
  const { config, logger, botOpenId, onMessage } = options;
  const eventDispatcher = new Lark.EventDispatcher({});

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      const envelope = data as FeishuEventEnvelope<FeishuMessageReceiveEvent>;
      const message = parseIncomingMessage(envelope, botOpenId);
      if (!message) {
        logger.warn("received message event but failed to parse payload");
        return;
      }
      logger.info(
        {
          messageId: message.messageId,
          chatId: message.chatId,
          chatType: message.chatType,
          messageType: message.messageType,
          senderOpenId: message.senderOpenId,
          mentionedBot: message.mentionedBot,
          textLength: message.text.length,
          attachmentCount: message.attachments.length,
          hasAskPrefix: message.text.trim().startsWith(config.feishuTriggerPrefix),
        },
        "inbound message received",
      );

      try {
        await onMessage(message);
      } catch (error) {
        logger.error({ err: error }, "failed to handle inbound message");
      }
    },
  });

  const wsClient = createFeishuWsClient(config);
  wsClient.start({ eventDispatcher });
  logger.info("feishu websocket monitor started");

  return {
    stop: () => {
      try {
        const anyClient = wsClient as unknown as { stop?: () => void; close?: () => void };
        anyClient.stop?.();
        anyClient.close?.();
      } catch (error) {
        logger.warn({ err: error }, "failed to stop ws client gracefully");
      }
    },
  };
}
