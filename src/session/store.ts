import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { SessionMessage, SessionOptions, SessionStore } from "../types/contracts.js";

type StoreOptions = {
  dedupRetentionMs: number;
  logger: Logger;
};

export class SQLiteSessionStore implements SessionStore {
  private readonly db: Database.Database;
  private readonly dedupRetentionMs: number;
  private readonly logger: Logger;
  private lastDedupCleanupAt = 0;

  public constructor(db: Database.Database, options: StoreOptions) {
    this.db = db;
    this.dedupRetentionMs = options.dedupRetentionMs;
    this.logger = options.logger;
  }

  public isDuplicate(messageId: string): boolean {
    this.cleanupDedupIfNeeded();
    const now = Date.now();
    const result = this.db
      .prepare("INSERT OR IGNORE INTO processed_events (message_id, seen_at) VALUES (?, ?)")
      .run(messageId, now);
    return result.changes === 0;
  }

  public appendUser(sessionKey: string, content: string): void {
    this.appendMessage(sessionKey, "user", content);
  }

  public appendAssistant(sessionKey: string, content: string): void {
    this.appendMessage(sessionKey, "assistant", content);
  }

  public loadRecent(sessionKey: string, turns: number): SessionMessage[] {
    const limit = Math.max(1, turns * 2);
    const rows = this.db
      .prepare(
        `SELECT role, content
         FROM messages
         WHERE session_key = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionKey, limit) as Array<{ role: "user" | "assistant"; content: string }>;

    return rows.reverse();
  }

  public getSessionOptions(sessionKey: string): SessionOptions {
    const row = this.db
      .prepare(
        `SELECT model, thinking_level
         FROM session_options
         WHERE session_key = ?`,
      )
      .get(sessionKey) as { model?: string | null; thinking_level?: "low" | "medium" | "high" | null } | undefined;

    if (!row) {
      return {};
    }

    return {
      model: row.model ?? undefined,
      thinkingLevel: row.thinking_level ?? undefined,
    };
  }

  public setSessionModel(sessionKey: string, model?: string): void {
    const current = this.getSessionOptions(sessionKey);
    this.upsertSessionOptions(sessionKey, model, current.thinkingLevel);
  }

  public setSessionThinkingLevel(sessionKey: string, thinkingLevel?: "low" | "medium" | "high"): void {
    const current = this.getSessionOptions(sessionKey);
    this.upsertSessionOptions(sessionKey, current.model, thinkingLevel);
  }

  public resetSession(sessionKey: string): void {
    const tx = this.db.transaction((key: string) => {
      this.db.prepare("DELETE FROM messages WHERE session_key = ?").run(key);
      this.db.prepare("DELETE FROM session_options WHERE session_key = ?").run(key);
      this.db.prepare("DELETE FROM sessions WHERE session_key = ?").run(key);
    });
    tx(sessionKey);
  }

  private appendMessage(sessionKey: string, role: "user" | "assistant", content: string): void {
    const now = Date.now();
    const tx = this.db.transaction((key: string, messageRole: "user" | "assistant", text: string) => {
      this.db
        .prepare("INSERT OR IGNORE INTO sessions (session_key, created_at) VALUES (?, ?)")
        .run(key, now);
      this.db
        .prepare(
          "INSERT INTO messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(key, messageRole, text, now);
    });

    tx(sessionKey, role, content);
  }

  private upsertSessionOptions(
    sessionKey: string,
    model: string | undefined,
    thinkingLevel: "low" | "medium" | "high" | undefined,
  ): void {
    const now = Date.now();
    const tx = this.db.transaction(
      (
        key: string,
        newModel: string | null,
        newThinkingLevel: "low" | "medium" | "high" | null,
      ) => {
        this.db
          .prepare("INSERT OR IGNORE INTO sessions (session_key, created_at) VALUES (?, ?)")
          .run(key, now);
        this.db
          .prepare(
            `INSERT INTO session_options (session_key, model, thinking_level, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_key) DO UPDATE SET
               model = excluded.model,
               thinking_level = excluded.thinking_level,
               updated_at = excluded.updated_at`,
          )
          .run(key, newModel, newThinkingLevel, now);
      },
    );
    tx(sessionKey, model ?? null, thinkingLevel ?? null);
  }

  private cleanupDedupIfNeeded(): void {
    const now = Date.now();
    const cleanupIntervalMs = 5 * 60 * 1000;
    if (now - this.lastDedupCleanupAt < cleanupIntervalMs) {
      return;
    }

    const cutoff = now - this.dedupRetentionMs;
    const deleted = this.db
      .prepare("DELETE FROM processed_events WHERE seen_at < ?")
      .run(cutoff).changes;

    if (deleted > 0) {
      this.logger.debug({ deleted }, "cleaned up expired dedup records");
    }

    this.lastDedupCleanupAt = now;
  }
}
