import pino from "pino";
import type { LogLevel } from "./types/config.js";

export function createLogger(level: LogLevel) {
  return pino({
    level,
    redact: {
      paths: ["req.headers.authorization", "config.feishuAppSecret"],
      censor: "[REDACTED]",
    },
  });
}
