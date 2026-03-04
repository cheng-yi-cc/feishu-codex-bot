import http from "node:http";
import type { Logger } from "pino";

type HealthSnapshot = {
  startedAt: number;
  queueLength: number;
  lastErrorAt: number | null;
};

type HealthServerOptions = {
  port: number;
  logger: Logger;
  getSnapshot: () => HealthSnapshot;
};

export type HealthServerHandle = {
  stop: () => Promise<void>;
};

export function startHealthServer(options: HealthServerOptions): HealthServerHandle {
  const { port, logger, getSnapshot } = options;

  const server = http.createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }

    const snapshot = getSnapshot();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        startedAt: new Date(snapshot.startedAt).toISOString(),
        uptimeMs: Date.now() - snapshot.startedAt,
        queueLength: snapshot.queueLength,
        lastErrorAt: snapshot.lastErrorAt ? new Date(snapshot.lastErrorAt).toISOString() : null,
      }),
    );
  });

  server.listen(port, () => {
    logger.info({ port }, "health server started");
  });

  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
