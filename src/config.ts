import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { BotConfig, LogLevel } from "./types/config.js";

loadDotenv();

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

const envSchema = z.object({
  FEISHU_APP_ID: z.string().min(1, "FEISHU_APP_ID is required"),
  FEISHU_APP_SECRET: z.string().min(1, "FEISHU_APP_SECRET is required"),
  FEISHU_DOMAIN: z.string().default("feishu"),
  FEISHU_ALLOW_OPEN_IDS: z.string().default(""),
  FEISHU_REQUIRE_MENTION: z.string().default("true"),
  FEISHU_TRIGGER_PREFIX: z.string().default("/ask"),
  CODEX_BIN: z.string().default("codex"),
  CODEX_WORKDIR: z.string().default(path.join(homedir(), ".codex", "feishu-codex-bot", "workspace")),
  CODEX_SANDBOX_MODE: z.string().default("danger-full-access"),
  CODEX_TIMEOUT_MS: z.string().default("120000"),
  CODEX_HISTORY_TURNS: z.string().default("20"),
  CODEX_DEFAULT_MODEL: z.string().default(""),
  CODEX_DEFAULT_THINKING_LEVEL: z.string().default("medium"),
  DB_PATH: z.string().default("./data/bot.sqlite"),
  LOG_DIR: z.string().default("./logs"),
  LOG_LEVEL: z.string().default("info"),
  HEALTH_PORT: z.string().default("8787"),
  SUPERVISOR_MAX_RESTARTS: z.string().default("5"),
  SUPERVISOR_RESTART_DELAY_MS: z.string().default("3000"),
});

function parseBoolean(raw: string, key: string): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

function parsePositiveInt(raw: string, key: string): number {
  const num = Number.parseInt(raw, 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return num;
}

function parseLogLevel(raw: string): LogLevel {
  if ((logLevels as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  throw new Error(`LOG_LEVEL must be one of: ${logLevels.join(", ")}`);
}

function parseThinkingLevel(raw: string, key: string): "low" | "medium" | "high" {
  const value = raw.trim().toLowerCase();
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`${key} must be one of: low, medium, high`);
}

function parseAllowOpenIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
        .join("; "),
    );
  }

  const cfg = parsed.data;
  if (cfg.FEISHU_TRIGGER_PREFIX !== "/ask") {
    throw new Error("FEISHU_TRIGGER_PREFIX must be /ask in v1");
  }
  if (cfg.CODEX_SANDBOX_MODE !== "danger-full-access") {
    throw new Error("CODEX_SANDBOX_MODE must be danger-full-access");
  }

  return {
    feishuAppId: cfg.FEISHU_APP_ID,
    feishuAppSecret: cfg.FEISHU_APP_SECRET,
    feishuDomain: cfg.FEISHU_DOMAIN,
    feishuAllowOpenIds: parseAllowOpenIds(cfg.FEISHU_ALLOW_OPEN_IDS),
    feishuRequireMention: parseBoolean(cfg.FEISHU_REQUIRE_MENTION, "FEISHU_REQUIRE_MENTION"),
    feishuTriggerPrefix: "/ask",
    codexBin: cfg.CODEX_BIN,
    codexWorkdir: path.resolve(cfg.CODEX_WORKDIR),
    codexSandboxMode: "danger-full-access",
    codexTimeoutMs: parsePositiveInt(cfg.CODEX_TIMEOUT_MS, "CODEX_TIMEOUT_MS"),
    codexHistoryTurns: parsePositiveInt(cfg.CODEX_HISTORY_TURNS, "CODEX_HISTORY_TURNS"),
    codexDefaultModel: cfg.CODEX_DEFAULT_MODEL.trim() || undefined,
    codexDefaultThinkingLevel: parseThinkingLevel(
      cfg.CODEX_DEFAULT_THINKING_LEVEL,
      "CODEX_DEFAULT_THINKING_LEVEL",
    ),
    dbPath: path.resolve(cfg.DB_PATH),
    logDir: path.resolve(cfg.LOG_DIR),
    logLevel: parseLogLevel(cfg.LOG_LEVEL),
    healthPort: parsePositiveInt(cfg.HEALTH_PORT, "HEALTH_PORT"),
    replyChunkChars: 3200,
    dedupRetentionMs: 7 * 24 * 60 * 60 * 1000,
    supervisorMaxRestarts: parsePositiveInt(
      cfg.SUPERVISOR_MAX_RESTARTS,
      "SUPERVISOR_MAX_RESTARTS",
    ),
    supervisorRestartDelayMs: parsePositiveInt(
      cfg.SUPERVISOR_RESTART_DELAY_MS,
      "SUPERVISOR_RESTART_DELAY_MS",
    ),
  };
}
