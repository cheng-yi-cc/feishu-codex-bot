import fs from "node:fs";
import type { Logger } from "pino";
import type { BotConfig } from "../types/config.js";

export type AppSupervisorHandle = {
  stop: () => Promise<void>;
};

export type AppSupervisorSnapshot = {
  restartCount: number;
  lastErrorAt: number | null;
};

export function createAppSupervisor(input: {
  logger: Logger;
  config: BotConfig;
  verifyBinary?: (value: string) => Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
  startApplication: () => Promise<AppSupervisorHandle>;
}) {
  const verifyBinary =
    input.verifyBinary ??
    (async (value: string) => {
      try {
        await import("node:child_process").then(({ execFileSync }) =>
          execFileSync(value, ["--version"], { stdio: "ignore" }),
        );
        return true;
      } catch {
        return false;
      }
    });
  const wait =
    input.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let restartCount = 0;
  let currentApp: AppSupervisorHandle | undefined;
  let lastErrorAt: number | null = null;

  async function preflight(): Promise<void> {
    fs.mkdirSync(input.config.logDir, { recursive: true });
    fs.mkdirSync(input.config.codexWorkdir, { recursive: true });

    const hasCodex = await verifyBinary(input.config.codexBin);
    if (!hasCodex) {
      throw new Error(`codex binary is unavailable: ${input.config.codexBin}`);
    }
  }

  async function stopCurrentApp(): Promise<void> {
    if (currentApp) {
      await currentApp.stop();
      currentApp = undefined;
    }
  }

  function recordRestart(error: unknown, message: string): void {
    restartCount += 1;
    lastErrorAt = Date.now();
    input.logger.error({ err: error, restartCount }, message);
  }

  return {
    async start(): Promise<void> {
      let attempts = 0;

      while (true) {
        try {
          await preflight();
          currentApp = await input.startApplication();
          return;
        } catch (error) {
          await stopCurrentApp();

          if (attempts >= input.config.supervisorMaxRestarts) {
            recordRestart(error, "application start failed and restart limit was reached");
            throw error;
          }

          recordRestart(error, "application start failed; retrying");
          attempts += 1;
          await wait(input.config.supervisorRestartDelayMs);
        }
      }
    },
    stop: stopCurrentApp,
    markRestart(error: unknown): void {
      recordRestart(error, "application restart requested");
    },
    getSnapshot(): AppSupervisorSnapshot {
      return { restartCount, lastErrorAt };
    },
  };
}
