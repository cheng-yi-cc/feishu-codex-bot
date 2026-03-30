import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createCodexRunner } from "./codex/runner.js";
import { createFeishuClient, fetchBotOpenId } from "./feishu/client.js";
import { startFeishuMonitor } from "./feishu/monitor.js";
import { openSessionDatabase } from "./session/migrations.js";
import { SQLiteSessionStore } from "./session/store.js";
import { SerialTaskQueue } from "./bot/queue.js";
import { createMessageHandler, type RuntimeStatus } from "./bot/handler.js";
import { startHealthServer } from "./health/server.js";
import { createAppSupervisor } from "./runtime/supervisor.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  let supervisor!: ReturnType<typeof createAppSupervisor>;
  let shuttingDown = false;

  const shutdown = async (
    reason: string,
    exitCode: number,
    error?: unknown,
  ): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (error) {
      supervisor.markRestart(error);
      logger.error({ err: error, reason }, "bot shutting down after fatal error");
    } else {
      logger.info({ reason }, "shutdown signal received");
    }

    await supervisor.stop();
    process.exit(exitCode);
  };

  supervisor = createAppSupervisor({
    logger,
    config,
    startApplication: async () => {
      fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

      const db = openSessionDatabase(config.dbPath);
      try {
        const store = new SQLiteSessionStore(db, {
          dedupRetentionMs: config.dedupRetentionMs,
          logger,
        });

        const queue = new SerialTaskQueue();
        const runtimeStatus: RuntimeStatus = {
          startedAt: Date.now(),
          lastErrorAt: null,
        };

        const codexRunner = createCodexRunner({
          codexBin: config.codexBin,
          sandboxMode: config.codexSandboxMode,
          defaultWorkdir: config.codexWorkdir,
          timeoutMs: config.codexTimeoutMs,
        });

        const feishuClient = createFeishuClient(config);
        const botOpenId = await fetchBotOpenId(feishuClient);
        logger.info({ botOpenId }, "bot open id resolved");

        const handler = createMessageHandler({
          config,
          logger,
          store,
          codexRunner,
          queue,
          feishuClient,
          runtimeStatus,
        });

        const monitor = startFeishuMonitor({
          config,
          logger,
          botOpenId,
          onMessage: handler,
        });

        const healthServer = startHealthServer({
          port: config.healthPort,
          logger,
          getSnapshot: () => ({
            startedAt: runtimeStatus.startedAt,
            queueLength: queue.getPendingCount(),
            lastErrorAt: runtimeStatus.lastErrorAt,
            codexWorkdir: config.codexWorkdir,
            logDir: config.logDir,
            supervisor: {
              ...supervisor.getSnapshot(),
              maxRestarts: config.supervisorMaxRestarts,
              restartDelayMs: config.supervisorRestartDelayMs,
            },
          }),
        });

        let stopped = false;
        return {
          stop: async () => {
            if (stopped) {
              return;
            }
            stopped = true;
            monitor.stop();
            await healthServer.stop();
            db.close();
          },
        };
      } catch (error) {
        db.close();
        throw error;
      }
    },
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT", 0);
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", 0);
  });
  process.on("uncaughtException", (error) => {
    void shutdown("uncaughtException", 1, error);
  });
  process.on("unhandledRejection", (reason) => {
    void shutdown(
      "unhandledRejection",
      1,
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  });

  await supervisor.start();
  logger.info("feishu-codex-bot started");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
