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

async function main(): Promise<void> {
  const config = loadConfig();
  fs.mkdirSync(config.codexWorkdir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const logger = createLogger(config.logLevel);
  const db = openSessionDatabase(config.dbPath);
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
    }),
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutdown signal received");
    monitor.stop();
    await healthServer.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logger.info("feishu-codex-bot started");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
