import type { BotConfig } from "../types/config.js";
import type { IncomingMessage } from "../types/contracts.js";

export type AccessDecision = {
  allowed: boolean;
  reason?: string;
  notify?: boolean;
};

export function enforceAccessPolicy(config: BotConfig, message: IncomingMessage): AccessDecision {
  const whitelistEnabled = config.feishuAllowOpenIds.size > 0;
  if (whitelistEnabled && !config.feishuAllowOpenIds.has(message.senderOpenId)) {
    return {
      allowed: false,
      reason: "你未在机器人白名单中，请联系管理员开通。",
    };
  }

  if (message.chatType === "group" && config.feishuRequireMention && !message.mentionedBot) {
    return {
      allowed: false,
      reason: "群聊需 @机器人 才会触发。",
      notify: false,
    };
  }

  return { allowed: true };
}
