import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createAppSupervisor } from "../src/runtime/supervisor.js";

describe("createAppSupervisor", () => {
  it("fails preflight when codex is missing", async () => {
    const supervisor = createAppSupervisor({
      logger: pino({ enabled: false }),
      config: {
        codexBin: "missing-codex",
        codexWorkdir: "D:\\My Project\\feishu-codex-bot\\workspace",
        logDir: "D:\\My Project\\feishu-codex-bot\\logs",
        supervisorMaxRestarts: 3,
        supervisorRestartDelayMs: 1000,
      } as any,
      verifyBinary: vi.fn(async () => false),
      startApplication: vi.fn(),
    });

    await expect(supervisor.start()).rejects.toThrow(/codex/i);
  });

  it("tracks restart snapshot metadata", async () => {
    const supervisor = createAppSupervisor({
      logger: pino({ enabled: false }),
      config: {
        codexBin: "codex",
        codexWorkdir: "D:\\My Project\\feishu-codex-bot\\workspace",
        logDir: "D:\\My Project\\feishu-codex-bot\\logs",
        supervisorMaxRestarts: 3,
        supervisorRestartDelayMs: 1000,
      } as any,
      verifyBinary: vi.fn(async () => true),
      startApplication: vi.fn(async () => ({
        stop: vi.fn(async () => undefined),
      })),
    });

    await supervisor.start();
    expect(supervisor.getSnapshot()).toEqual({
      restartCount: 0,
      lastErrorAt: null,
    });

    supervisor.markRestart(new Error("boom"));

    expect(supervisor.getSnapshot()).toMatchObject({
      restartCount: 1,
      lastErrorAt: expect.any(Number),
    });
  });
});
