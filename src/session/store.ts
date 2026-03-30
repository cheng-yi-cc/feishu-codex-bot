import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type {
  SessionMessage,
  SessionOptions,
  SessionStore,
} from "../types/contracts.js";
import type {
  RuntimeStore,
  TaskArtifactRecord,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  WorkspaceState,
  WorkspaceMode,
} from "../runtime/types.js";

type StoreOptions = {
  dedupRetentionMs: number;
  logger: Logger;
};

type WorkspaceStateRow = {
  session_key: string;
  mode: WorkspaceMode;
  cwd: string;
  branch: string | null;
  last_task_id: string | null;
  last_error_summary: string | null;
  updated_at: number;
};

type TaskRow = {
  id: string;
  session_key: string;
  kind: TaskRecord["kind"];
  title: string;
  input_text: string;
  status: TaskStatus;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  summary: string | null;
  error_summary: string | null;
};

type TaskEventRow = {
  task_id: string;
  seq: number;
  phase: TaskEventRecord["phase"];
  message: string;
  created_at: number;
};

type TaskArtifactRow = {
  task_id: string;
  kind: TaskArtifactRecord["kind"];
  label: string;
  value: string;
  created_at: number;
};

export class SQLiteSessionStore implements SessionStore, RuntimeStore {
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
      .get(sessionKey) as
      | { model?: string | null; thinking_level?: "low" | "medium" | "high" | null }
      | undefined;

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

  public saveWorkspaceState(state: WorkspaceState): void {
    const tx = this.db.transaction((workspaceState: WorkspaceState) => {
      this.db
        .prepare(
          `INSERT INTO workspace_state (
             session_key, mode, cwd, branch, last_task_id, last_error_summary, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_key) DO UPDATE SET
             mode = excluded.mode,
             cwd = excluded.cwd,
             branch = excluded.branch,
             last_task_id = excluded.last_task_id,
             last_error_summary = excluded.last_error_summary,
             updated_at = excluded.updated_at`,
        )
        .run(
          workspaceState.sessionKey,
          workspaceState.mode,
          workspaceState.cwd,
          workspaceState.branch ?? null,
          workspaceState.lastTaskId ?? null,
          workspaceState.lastErrorSummary ?? null,
          workspaceState.updatedAt,
        );
    });

    tx(state);
  }

  public getWorkspaceState(sessionKey: string): WorkspaceState | undefined {
    const row = this.db
      .prepare(
        `SELECT session_key, mode, cwd, branch, last_task_id, last_error_summary, updated_at
         FROM workspace_state
         WHERE session_key = ?`,
      )
      .get(sessionKey) as WorkspaceStateRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      sessionKey: row.session_key,
      mode: row.mode,
      cwd: row.cwd,
      branch: row.branch ?? undefined,
      lastTaskId: row.last_task_id ?? undefined,
      lastErrorSummary: row.last_error_summary ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  public createTask(task: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (
           id, session_key, kind, title, input_text, status,
           created_at, started_at, finished_at, summary, error_summary
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.sessionKey,
        task.kind,
        task.title,
        task.inputText,
        task.status,
        task.createdAt,
        task.startedAt ?? null,
        task.finishedAt ?? null,
        task.summary ?? null,
        task.errorSummary ?? null,
      );
  }

  public getTask(taskId: string): TaskRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, session_key, kind, title, input_text, status, created_at,
                started_at, finished_at, summary, error_summary
         FROM tasks
         WHERE id = ?`,
      )
      .get(taskId) as TaskRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.mapTaskRow(row);
  }

  public listRecentTasks(sessionKey: string, limit: number): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_key, kind, title, input_text, status, created_at,
                started_at, finished_at, summary, error_summary
         FROM tasks
         WHERE session_key = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(sessionKey, Math.max(1, limit)) as TaskRow[];

    return rows.map((row) => this.mapTaskRow(row));
  }

  public updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    updates: Partial<Pick<TaskRecord, "startedAt" | "finishedAt" | "summary" | "errorSummary">> = {},
  ): void {
    const assignments: string[] = ["status = ?"];
    const values: unknown[] = [status];

    if (updates.startedAt !== undefined) {
      assignments.push("started_at = ?");
      values.push(updates.startedAt);
    }
    if (updates.finishedAt !== undefined) {
      assignments.push("finished_at = ?");
      values.push(updates.finishedAt);
    }
    if (updates.summary !== undefined) {
      assignments.push("summary = ?");
      values.push(updates.summary);
    }
    if (updates.errorSummary !== undefined) {
      assignments.push("error_summary = ?");
      values.push(updates.errorSummary);
    }

    values.push(taskId);
    this.db
      .prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  public appendTaskEvent(event: TaskEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO task_events (task_id, seq, phase, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.taskId, event.seq, event.phase, event.message, event.createdAt);
  }

  public loadTaskEvents(taskId: string, limit: number): TaskEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, seq, phase, message, created_at
         FROM task_events
         WHERE task_id = ?
         ORDER BY seq DESC
         LIMIT ?`,
      )
      .all(taskId, Math.max(1, limit)) as TaskEventRow[];

    return rows.reverse().map((row) => ({
      taskId: row.task_id,
      seq: row.seq,
      phase: row.phase,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  public replaceTaskArtifacts(taskId: string, artifacts: TaskArtifactRecord[]): void {
    const tx = this.db.transaction((key: string, items: TaskArtifactRecord[]) => {
      this.db.prepare("DELETE FROM task_artifacts WHERE task_id = ?").run(key);

      const insert = this.db.prepare(
        `INSERT INTO task_artifacts (task_id, kind, label, value, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const artifact of items) {
        insert.run(key, artifact.kind, artifact.label, artifact.value, artifact.createdAt);
      }
    });

    tx(taskId, artifacts);
  }

  public listTaskArtifacts(taskId: string): TaskArtifactRecord[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, kind, label, value, created_at
         FROM task_artifacts
         WHERE task_id = ?
         ORDER BY created_at ASC, kind ASC, label ASC, value ASC`,
      )
      .all(taskId) as TaskArtifactRow[];

    return rows.map((row) => ({
      taskId: row.task_id,
      kind: row.kind,
      label: row.label,
      value: row.value,
      createdAt: row.created_at,
    }));
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

  private mapTaskRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      sessionKey: row.session_key,
      kind: row.kind,
      title: row.title,
      inputText: row.input_text,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      summary: row.summary ?? undefined,
      errorSummary: row.error_summary ?? undefined,
    };
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
