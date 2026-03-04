import * as Lark from "@larksuiteoapi/node-sdk";
import type { BotConfig } from "../types/config.js";

export function createFeishuClient(config: BotConfig): Lark.Client {
  return new Lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain:
      config.feishuDomain === "lark"
        ? Lark.Domain.Lark
        : config.feishuDomain === "feishu"
          ? Lark.Domain.Feishu
          : config.feishuDomain,
  });
}

export function createFeishuWsClient(config: BotConfig): Lark.WSClient {
  return new Lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain:
      config.feishuDomain === "lark"
        ? Lark.Domain.Lark
        : config.feishuDomain === "feishu"
          ? Lark.Domain.Feishu
          : config.feishuDomain,
    loggerLevel: Lark.LoggerLevel.info,
  });
}

export async function fetchBotOpenId(client: Lark.Client): Promise<string> {
  const response = (await (client as any).request({
    method: "GET",
    url: "/open-apis/bot/v3/info",
    data: {},
  })) as {
    code?: number;
    msg?: string;
    bot?: { open_id?: string };
    data?: { bot?: { open_id?: string } };
  };

  if (response.code !== 0) {
    throw new Error(`failed to fetch bot info: ${response.msg ?? `code ${response.code}`}`);
  }

  const openId = response.bot?.open_id ?? response.data?.bot?.open_id;
  if (!openId) {
    throw new Error("bot open_id missing in /bot/v3/info response");
  }

  return openId;
}
