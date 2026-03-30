import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret",
};

describe("loadConfig", () => {
  it("loads defaults", () => {
    const cfg = loadConfig(baseEnv);

    expect(cfg.feishuTriggerPrefix).toBe("/ask");
    expect(cfg.codexSandboxMode).toBe("danger-full-access");
    expect(cfg.codexTimeoutMs).toBe(120000);
    expect(cfg.codexHistoryTurns).toBe(20);
    expect(cfg.healthPort).toBe(8787);
    expect(cfg.dbPath).toContain(path.join("data", "bot.sqlite"));
    expect(cfg.logDir).toBe(path.resolve("./logs"));
  });

  it("loads explicit log directory when provided", () => {
    const cfg = loadConfig({
      ...baseEnv,
      CODEX_WORKDIR: "D:\\workspace",
      LOG_DIR: "D:\\shared-logs",
    });

    expect(cfg.logDir).toBe(path.resolve("D:\\shared-logs"));
  });

  it("loads supervisor restart settings", () => {
    expect(
      loadConfig({
        ...process.env,
        FEISHU_APP_ID: "cli_x",
        FEISHU_APP_SECRET: "secret",
        LOG_DIR: "./logs",
        SUPERVISOR_MAX_RESTARTS: "5",
        SUPERVISOR_RESTART_DELAY_MS: "3000",
      }),
    ).toMatchObject({
      logDir: expect.stringContaining("logs"),
      supervisorMaxRestarts: 5,
      supervisorRestartDelayMs: 3000,
    });
  });

  it("rejects invalid trigger prefix", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        FEISHU_TRIGGER_PREFIX: "/foo",
      }),
    ).toThrow(/FEISHU_TRIGGER_PREFIX/);
  });

  it("rejects non-boolean FEISHU_REQUIRE_MENTION", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        FEISHU_REQUIRE_MENTION: "abc",
      }),
    ).toThrow(/FEISHU_REQUIRE_MENTION/);
  });

  it("rejects invalid CODEX_DEFAULT_THINKING_LEVEL", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        CODEX_DEFAULT_THINKING_LEVEL: "ultra",
      }),
    ).toThrow(/CODEX_DEFAULT_THINKING_LEVEL/);
  });
});
