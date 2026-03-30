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

  return {
    async start(): Promise<void> {
      await preflight();
      currentApp = await input.startApplication();
    },
    async stop(): Promise<void> {
      if (currentApp) {
        await currentApp.stop();
        currentApp = undefined;
      }
    },
    markRestart(error: unknown): void {
      restartCount += 1;
      lastErrorAt = Date.now();
      input.logger.error({ err: error, restartCount }, "application restart requested");
    },
    getSnapshot(): AppSupervisorSnapshot {
      return { restartCount, lastErrorAt };
    },
  };
}
