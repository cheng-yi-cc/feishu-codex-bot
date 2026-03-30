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
      wait: vi.fn(async () => undefined),
      startApplication: vi.fn(),
    });

    await expect(supervisor.start()).rejects.toThrow(/codex/i);
  });

  it("retries startup failures before succeeding", async () => {
    const startApplication = vi
      .fn<() => Promise<{ stop: () => Promise<void> }>>()
      .mockRejectedValueOnce(new Error("boot failed"))
      .mockResolvedValueOnce({
        stop: vi.fn(async () => undefined),
      });
    const wait = vi.fn(async () => undefined);
    const supervisor = createAppSupervisor({
      logger: pino({ enabled: false }),
      config: {
        codexBin: "codex",
        codexWorkdir: "D:\\My Project\\feishu-codex-bot\\workspace",
        logDir: "D:\\My Project\\feishu-codex-bot\\logs",
        supervisorMaxRestarts: 2,
        supervisorRestartDelayMs: 1000,
      } as any,
      verifyBinary: vi.fn(async () => true),
      wait,
      startApplication,
    });

    await supervisor.start();

    expect(startApplication).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(supervisor.getSnapshot()).toMatchObject({
      restartCount: 1,
      lastErrorAt: expect.any(Number),
    });
  });

  it("fails clearly after exhausting startup retries", async () => {
    const startApplication = vi.fn(async () => {
      throw new Error("boot failed");
    });
    const wait = vi.fn(async () => undefined);
    const supervisor = createAppSupervisor({
      logger: pino({ enabled: false }),
      config: {
        codexBin: "codex",
        codexWorkdir: "D:\\My Project\\feishu-codex-bot\\workspace",
        logDir: "D:\\My Project\\feishu-codex-bot\\logs",
        supervisorMaxRestarts: 2,
        supervisorRestartDelayMs: 1000,
      } as any,
      verifyBinary: vi.fn(async () => true),
      wait,
      startApplication,
    });

    await expect(supervisor.start()).rejects.toThrow("boot failed");
    expect(startApplication).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(supervisor.getSnapshot()).toMatchObject({
      restartCount: 3,
      lastErrorAt: expect.any(Number),
    });
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
