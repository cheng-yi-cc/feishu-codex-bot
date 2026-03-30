export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export type BotConfig = {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: string;
  feishuAllowOpenIds: Set<string>;
  feishuRequireMention: boolean;
  feishuTriggerPrefix: "/ask";
  codexBin: string;
  codexWorkdir: string;
  codexSandboxMode: "danger-full-access";
  codexTimeoutMs: number;
  codexHistoryTurns: number;
  codexDefaultModel?: string;
  codexDefaultThinkingLevel: "low" | "medium" | "high";
  dbPath: string;
  logDir?: string;
  logLevel: LogLevel;
  healthPort: number;
  replyChunkChars: number;
  dedupRetentionMs: number;
};
