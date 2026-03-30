# Feishu Codex Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Feishu bot into a single-user Feishu Codex workspace with tracked development tasks, resumable state, developer control commands, and reliable Windows boot-time startup.

**Architecture:** Keep the existing Feishu WebSocket intake, SQLite persistence, attachment handling, and `codex exec` integration. Add a runtime layer for task/workspace state, a router/orchestrator/renderer split above the current handler, a workspace command runner below it, and a supervisor layer around startup so the bot can recover cleanly after reboots and crashes.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Vitest, PowerShell, Windows Task Scheduler, Feishu/Lark Node SDK

---

## File Structure

### New files

- `src/runtime/types.ts`
  Runtime domain types and interfaces for workspace state, task records, task events, artifacts, and the runtime store contract.
- `src/runtime/progress.ts`
  Translates Codex JSON stream events into concise Feishu progress messages.
- `src/runtime/orchestrator.ts`
  Creates tasks, persists progress, invokes Codex, coordinates workspace commands, and produces task results.
- `src/runtime/supervisor.ts`
  Preflight checks, health snapshot aggregation, restart tracking, and controlled app boot/shutdown.
- `src/bot/router.ts`
  Converts parsed commands and current workspace state into explicit user intents.
- `src/bot/response-renderer.ts`
  Renders `/status`, progress checkpoints, command results, resume summaries, and final task results into Feishu-friendly text.
- `src/workspace/path-policy.ts`
  Validates and resolves workspace-relative paths under the configured root.
- `src/workspace/command-runner.ts`
  Executes `/run`, `/test`, `/diff`, `/files`, `/logs`, and `/branch` commands in the active workspace.
- `tests/runtime-store.spec.ts`
  Persistence tests for workspace state, tasks, events, and artifacts.
- `tests/router.spec.ts`
  Intent-routing tests for natural chat and explicit commands.
- `tests/orchestrator.spec.ts`
  Runtime tests for task lifecycle, progress persistence, and resume behavior.
- `tests/path-policy.spec.ts`
  Path safety tests for workspace root enforcement.
- `tests/command-runner.spec.ts`
  Command execution tests for stdout/stderr capture, truncation, and git helper commands.
- `tests/supervisor.spec.ts`
  Supervisor tests for preflight failure handling and restart snapshots.
- `scripts/install-startup-task.ps1`
  Registers a Windows Task Scheduler entry that runs `start-bot.ps1` at startup.

### Existing files to modify

- `src/types/contracts.ts`
  Add Codex stream event types and request fields for progress callbacks and abort signals.
- `src/types/config.ts`
  Add runtime/supervisor config fields such as log directory and restart settings.
- `src/config.ts`
  Parse the new runtime and supervisor environment variables.
- `src/session/schema.sql`
  Add tables for workspace state, tasks, task events, and task artifacts.
- `src/session/store.ts`
  Extend `SQLiteSessionStore` to implement the runtime store contract while preserving existing session history APIs.
- `src/session/migrations.ts`
  Keep schema bootstrapping intact while applying the expanded SQL schema.
- `src/bot/commands.ts`
  Parse `/mode`, `/resume`, `/cwd`, `/run`, `/test`, `/diff`, `/files`, `/logs`, `/branch`, `/apply`, and `/abort`.
- `src/bot/handler.ts`
  Replace the one-shot control flow with parser + router + orchestrator + renderer composition.
- `src/codex/types.ts`
  Add result/progress types used by the orchestrator.
- `src/codex/runner.ts`
  Emit normalized progress events while still returning the final answer.
- `src/feishu/sender.ts`
  Support compact progress/status rendering without changing attachment behavior.
- `src/health/server.ts`
  Include richer runtime/supervisor snapshot data.
- `src/index.ts`
  Boot the app through the new supervisor and wire the new runtime dependencies.
- `start-bot.ps1`
  Launch the built app reliably, use persistent logs, and rely on the new supervisor.
- `ecosystem.config.cjs`
  Keep PM2 as a fallback local runner aligned with the new build/start path.
- `README.md`
  Document the new hybrid workflow, command set, and startup instructions.
- `.env.example`
  Add the new runtime and supervisor environment variables.
- `docs/ops-checklist.md`
  Update the runbook for supervisor/task snapshots and startup task verification.
- `docs/test-report.md`
  Add test cases for `/resume`, `/cwd`, `/run`, `/test`, `/diff`, `/logs`, interrupt recovery, and startup.

### Existing tests to modify

- `tests/commands.spec.ts`
  Cover the expanded command grammar.
- `tests/handler.spec.ts`
  Update handler tests to assert router/orchestrator-driven behavior.
- `tests/codex-runner.spec.ts`
  Assert progress callbacks and abort behavior.
- `tests/store.spec.ts`
  Keep legacy chat/session tests passing after store expansion.

## Task 1: Expand SQLite Persistence For Workspace Runtime

**Files:**
- Create: `src/runtime/types.ts`
- Create: `tests/runtime-store.spec.ts`
- Modify: `src/session/schema.sql`
- Modify: `src/session/store.ts`
- Modify: `src/session/migrations.ts`
- Modify: `src/types/contracts.ts`
- Test: `tests/store.spec.ts`
- Test: `tests/runtime-store.spec.ts`

- [ ] **Step 1: Write the failing runtime persistence test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pino from "pino";
import { openSessionDatabase } from "../src/session/migrations.js";
import { SQLiteSessionStore } from "../src/session/store.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const dbPath of tempPaths) {
    fs.rmSync(dbPath, { force: true });
  }
  tempPaths.length = 0;
});

describe("SQLiteSessionStore runtime state", () => {
  it("persists workspace state, tasks, events, and artifacts", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-runtime-${Date.now()}.sqlite`);
    tempPaths.push(dbPath);

    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    store.saveWorkspaceState({
      sessionKey: "dm:ou_dev",
      mode: "dev",
      cwd: "D:\\My Project\\feishu-codex-bot",
      branch: "main",
      lastTaskId: "task_1",
      lastErrorSummary: undefined,
      updatedAt: 100,
    });

    store.createTask({
      id: "task_1",
      sessionKey: "dm:ou_dev",
      kind: "dev",
      title: "Fix startup",
      inputText: "修好开机自启",
      status: "running",
      createdAt: 101,
      startedAt: 102,
      finishedAt: undefined,
      summary: undefined,
      errorSummary: undefined,
    });

    store.appendTaskEvent({
      taskId: "task_1",
      seq: 1,
      phase: "progress",
      message: "Launching Codex",
      createdAt: 103,
    });

    store.replaceTaskArtifacts("task_1", [
      {
        taskId: "task_1",
        kind: "log",
        label: "stderr",
        value: "logs/task_1.stderr.log",
        createdAt: 104,
      },
    ]);

    store.updateTaskStatus("task_1", "interrupted", {
      errorSummary: "process exited during run",
      finishedAt: 105,
    });

    expect(store.getWorkspaceState("dm:ou_dev")).toEqual({
      sessionKey: "dm:ou_dev",
      mode: "dev",
      cwd: "D:\\My Project\\feishu-codex-bot",
      branch: "main",
      lastTaskId: "task_1",
      lastErrorSummary: undefined,
      updatedAt: 100,
    });

    expect(store.getTask("task_1")).toMatchObject({
      id: "task_1",
      status: "interrupted",
      errorSummary: "process exited during run",
    });

    expect(store.loadTaskEvents("task_1", 10)).toEqual([
      {
        taskId: "task_1",
        seq: 1,
        phase: "progress",
        message: "Launching Codex",
        createdAt: 103,
      },
    ]);

    expect(store.listTaskArtifacts("task_1")).toEqual([
      {
        taskId: "task_1",
        kind: "log",
        label: "stderr",
        value: "logs/task_1.stderr.log",
        createdAt: 104,
      },
    ]);

    db.close();
  });
});
```

- [ ] **Step 2: Run the focused persistence tests and verify the new test fails**

Run: `npx vitest run tests/store.spec.ts tests/runtime-store.spec.ts`

Expected: FAIL with TypeScript or runtime errors mentioning missing methods such as `saveWorkspaceState`, `createTask`, or missing tables such as `workspace_state` / `tasks`.

- [ ] **Step 3: Implement runtime types, schema, and store methods**

`src/runtime/types.ts`

```ts
export type WorkspaceMode = "chat" | "dev";

export type TaskKind = "chat" | "dev" | "control";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "interrupted"
  | "failed"
  | "completed"
  | "resumable";

export type TaskEventPhase = "queued" | "progress" | "result" | "error";

export type TaskArtifactKind = "diff" | "log" | "file" | "command_output";

export type WorkspaceState = {
  sessionKey: string;
  mode: WorkspaceMode;
  cwd: string;
  branch?: string;
  lastTaskId?: string;
  lastErrorSummary?: string;
  updatedAt: number;
};

export type TaskRecord = {
  id: string;
  sessionKey: string;
  kind: TaskKind;
  title: string;
  inputText: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  summary?: string;
  errorSummary?: string;
};

export type TaskEventRecord = {
  taskId: string;
  seq: number;
  phase: TaskEventPhase;
  message: string;
  createdAt: number;
};

export type TaskArtifactRecord = {
  taskId: string;
  kind: TaskArtifactKind;
  label: string;
  value: string;
  createdAt: number;
};

export interface RuntimeStore {
  saveWorkspaceState(state: WorkspaceState): void;
  getWorkspaceState(sessionKey: string): WorkspaceState | undefined;
  createTask(task: TaskRecord): void;
  getTask(taskId: string): TaskRecord | undefined;
  listRecentTasks(sessionKey: string, limit: number): TaskRecord[];
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    patch?: Pick<TaskRecord, "summary" | "errorSummary" | "startedAt" | "finishedAt">,
  ): void;
  appendTaskEvent(event: TaskEventRecord): void;
  loadTaskEvents(taskId: string, limit: number): TaskEventRecord[];
  replaceTaskArtifacts(taskId: string, artifacts: TaskArtifactRecord[]): void;
  listTaskArtifacts(taskId: string): TaskArtifactRecord[];
}
```

`src/session/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS processed_events (
  message_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_seen_at
  ON processed_events (seen_at);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_options (
  session_key TEXT PRIMARY KEY,
  model TEXT,
  thinking_level TEXT CHECK (thinking_level IN ('low', 'medium', 'high')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages (session_key, created_at);

CREATE TABLE IF NOT EXISTS workspace_state (
  session_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('chat', 'dev')),
  cwd TEXT NOT NULL,
  branch TEXT,
  last_task_id TEXT,
  last_error_summary TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'dev', 'control')),
  title TEXT NOT NULL,
  input_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_for_input', 'interrupted', 'failed', 'completed', 'resumable')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  summary TEXT,
  error_summary TEXT,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_session_created
  ON tasks (session_key, created_at DESC);

CREATE TABLE IF NOT EXISTS task_events (
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('queued', 'progress', 'result', 'error')),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, seq),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_artifacts (
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('diff', 'log', 'file', 'command_output')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

`src/session/store.ts`

```ts
import type { RuntimeStore, TaskArtifactRecord, TaskEventRecord, TaskRecord, TaskStatus, WorkspaceState } from "../runtime/types.js";

export class SQLiteSessionStore implements SessionStore, RuntimeStore {
  public saveWorkspaceState(state: WorkspaceState): void {
    this.db
      .prepare(
        `INSERT INTO workspace_state (session_key, mode, cwd, branch, last_task_id, last_error_summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           mode = excluded.mode,
           cwd = excluded.cwd,
           branch = excluded.branch,
           last_task_id = excluded.last_task_id,
           last_error_summary = excluded.last_error_summary,
           updated_at = excluded.updated_at`,
      )
      .run(
        state.sessionKey,
        state.mode,
        state.cwd,
        state.branch ?? null,
        state.lastTaskId ?? null,
        state.lastErrorSummary ?? null,
        state.updatedAt,
      );
  }

  public getWorkspaceState(sessionKey: string): WorkspaceState | undefined {
    const row = this.db
      .prepare(
        `SELECT session_key, mode, cwd, branch, last_task_id, last_error_summary, updated_at
         FROM workspace_state
         WHERE session_key = ?`,
      )
      .get(sessionKey) as
      | {
          session_key: string;
          mode: "chat" | "dev";
          cwd: string;
          branch: string | null;
          last_task_id: string | null;
          last_error_summary: string | null;
          updated_at: number;
        }
      | undefined;

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
        `INSERT INTO tasks (id, session_key, kind, title, input_text, status, created_at, started_at, finished_at, summary, error_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        `SELECT id, session_key, kind, title, input_text, status, created_at, started_at, finished_at, summary, error_summary
         FROM tasks
         WHERE id = ?`,
      )
      .get(taskId) as
      | {
          id: string;
          session_key: string;
          kind: "chat" | "dev" | "control";
          title: string;
          input_text: string;
          status: TaskStatus;
          created_at: number;
          started_at: number | null;
          finished_at: number | null;
          summary: string | null;
          error_summary: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

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

  public listRecentTasks(sessionKey: string, limit: number): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT id, session_key, kind, title, input_text, status, created_at, started_at, finished_at, summary, error_summary
         FROM tasks
         WHERE session_key = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(sessionKey, limit)
      .map((row: any) => ({
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
      }));
  }
```

```ts
  public updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    patch: Pick<TaskRecord, "summary" | "errorSummary" | "startedAt" | "finishedAt"> = {},
  ): void {
    this.db
      .prepare(
        `UPDATE tasks
         SET status = ?,
             summary = COALESCE(?, summary),
             error_summary = COALESCE(?, error_summary),
             started_at = COALESCE(?, started_at),
             finished_at = COALESCE(?, finished_at)
         WHERE id = ?`,
      )
      .run(
        status,
        patch.summary ?? null,
        patch.errorSummary ?? null,
        patch.startedAt ?? null,
        patch.finishedAt ?? null,
        taskId,
      );
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
    return this.db
      .prepare(
        `SELECT task_id, seq, phase, message, created_at
         FROM task_events
         WHERE task_id = ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(taskId, limit)
      .map((row: any) => ({
        taskId: row.task_id,
        seq: row.seq,
        phase: row.phase,
        message: row.message,
        createdAt: row.created_at,
      }));
  }

  public replaceTaskArtifacts(taskId: string, artifacts: TaskArtifactRecord[]): void {
    const tx = this.db.transaction((rows: TaskArtifactRecord[]) => {
      this.db.prepare("DELETE FROM task_artifacts WHERE task_id = ?").run(taskId);
      const statement = this.db.prepare(
        `INSERT INTO task_artifacts (task_id, kind, label, value, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const artifact of rows) {
        statement.run(artifact.taskId, artifact.kind, artifact.label, artifact.value, artifact.createdAt);
      }
    });
    tx(artifacts);
  }

  public listTaskArtifacts(taskId: string): TaskArtifactRecord[] {
    return this.db
      .prepare(
        `SELECT task_id, kind, label, value, created_at
         FROM task_artifacts
         WHERE task_id = ?
         ORDER BY created_at ASC`,
      )
      .all(taskId)
      .map((row: any) => ({
        taskId: row.task_id,
        kind: row.kind,
        label: row.label,
        value: row.value,
        createdAt: row.created_at,
      }));
  }
}
```

- [ ] **Step 4: Run the persistence tests again and verify they pass**

Run: `npx vitest run tests/store.spec.ts tests/runtime-store.spec.ts`

Expected: PASS with both the legacy session tests and the new runtime-state test green.

- [ ] **Step 5: Commit the persistence layer**

```bash
git add src/runtime/types.ts src/session/schema.sql src/session/store.ts src/session/migrations.ts src/types/contracts.ts tests/store.spec.ts tests/runtime-store.spec.ts
git commit -m "feat: persist workspace runtime state"
```

## Task 2: Add Intent Routing, Mode State, And The Expanded Command Surface

**Files:**
- Create: `src/bot/router.ts`
- Create: `tests/router.spec.ts`
- Modify: `src/bot/commands.ts`
- Modify: `src/runtime/types.ts`
- Modify: `tests/commands.spec.ts`
- Test: `tests/router.spec.ts`
- Test: `tests/commands.spec.ts`

- [ ] **Step 1: Write failing command and router tests**

`tests/commands.spec.ts`

```ts
expect(parseCommand(makeMessage("/mode dev"), "/ask")).toEqual({
  kind: "mode",
  mode: "dev",
});

expect(parseCommand(makeMessage("/resume"), "/ask")).toEqual({
  kind: "resume",
});

expect(parseCommand(makeMessage("/cwd D:\\My Project\\feishu-codex-bot"), "/ask")).toEqual({
  kind: "cwd",
  path: "D:\\My Project\\feishu-codex-bot",
});

expect(parseCommand(makeMessage("/run npm test"), "/ask")).toEqual({
  kind: "run",
  command: "npm test",
});

expect(parseCommand(makeMessage("/abort"), "/ask")).toEqual({
  kind: "abort",
});
```

`tests/router.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { resolveIntent } from "../src/bot/router.js";
import type { IncomingMessage } from "../src/types/contracts.js";

function makeMessage(text: string): IncomingMessage {
  return {
    messageId: "m_router",
    chatId: "oc_router",
    chatType: "p2p",
    senderOpenId: "ou_router",
    messageType: "text",
    text,
    mentionedBot: false,
    attachments: [],
  };
}

describe("resolveIntent", () => {
  it("routes plain text to a dev task when mode is dev", () => {
    const intent = resolveIntent({
      message: makeMessage("修复启动失败"),
      command: { kind: "ask", prompt: "修复启动失败" },
      workspaceMode: "dev",
    });

    expect(intent).toEqual({
      kind: "task.start",
      taskKind: "dev",
      prompt: "修复启动失败",
    });
  });

  it("routes resume and cwd commands explicitly", () => {
    expect(
      resolveIntent({
        message: makeMessage("/resume"),
        command: { kind: "resume" },
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.resume" });

    expect(
      resolveIntent({
        message: makeMessage("/cwd D:\\repo"),
        command: { kind: "cwd", path: "D:\\repo" },
        workspaceMode: "chat",
      }),
    ).toEqual({ kind: "workspace.cwd", path: "D:\\repo" });
  });
});
```

- [ ] **Step 2: Run the parser/router tests and verify they fail**

Run: `npx vitest run tests/commands.spec.ts tests/router.spec.ts`

Expected: FAIL with missing command variants such as `mode`, `resume`, `cwd`, `run`, or a missing `resolveIntent` export.

- [ ] **Step 3: Implement the expanded command grammar and user-intent router**

`src/runtime/types.ts`

```ts
export type UserIntent =
  | { kind: "task.start"; taskKind: TaskKind; prompt: string }
  | { kind: "workspace.mode"; mode?: WorkspaceMode }
  | { kind: "workspace.resume" }
  | { kind: "workspace.cwd"; path?: string }
  | { kind: "workspace.command"; command: "run" | "test" | "diff" | "files" | "logs" | "branch" | "apply" | "abort"; value?: string }
  | { kind: "reply.status" }
  | { kind: "reply.model" }
  | { kind: "reply.think" }
  | { kind: "session.reset" }
  | { kind: "noop" };
```

`src/bot/commands.ts`

```ts
export type ParsedCommand =
  | { kind: "ask"; prompt: string }
  | { kind: "new" }
  | { kind: "status" }
  | { kind: "resume" }
  | { kind: "mode"; mode?: "chat" | "dev"; reset?: boolean; invalidArg?: string }
  | { kind: "cwd"; path?: string }
  | { kind: "run"; command?: string }
  | { kind: "test"; target?: string }
  | { kind: "diff" }
  | { kind: "files" }
  | { kind: "logs" }
  | { kind: "branch"; name?: string }
  | { kind: "apply" }
  | { kind: "abort" }
  | { kind: "model"; model?: string; reset?: boolean; invalidArg?: string }
  | { kind: "think"; level?: "low" | "medium" | "high"; reset?: boolean; invalidArg?: string }
  | { kind: "none" };

if (text === "/resume") {
  return { kind: "resume" };
}

if (text === "/mode") {
  return { kind: "mode" };
}

if (text.startsWith("/mode ")) {
  const value = unwrapAngleArg(text.slice("/mode ".length)).toLowerCase();
  if (value === "default") return { kind: "mode", reset: true };
  if (value === "chat" || value === "dev") return { kind: "mode", mode: value };
  return { kind: "mode", invalidArg: text.slice("/mode ".length).trim() };
}

if (text === "/cwd") {
  return { kind: "cwd" };
}

if (text.startsWith("/cwd ")) {
  return { kind: "cwd", path: text.slice("/cwd ".length).trim() };
}

if (text.startsWith("/run ")) {
  return { kind: "run", command: text.slice("/run ".length).trim() };
}

if (text === "/diff") return { kind: "diff" };
if (text === "/files") return { kind: "files" };
if (text === "/logs") return { kind: "logs" };
if (text === "/apply") return { kind: "apply" };
if (text === "/abort") return { kind: "abort" };

if (text === "/test") return { kind: "test" };
if (text.startsWith("/test ")) {
  return { kind: "test", target: text.slice("/test ".length).trim() };
}

if (text === "/branch") return { kind: "branch" };
if (text.startsWith("/branch ")) {
  return { kind: "branch", name: text.slice("/branch ".length).trim() };
}
```

`src/bot/router.ts`

```ts
import type { IncomingMessage } from "../types/contracts.js";
import type { ParsedCommand } from "./commands.js";
import type { UserIntent, WorkspaceMode } from "../runtime/types.js";

export function resolveIntent(input: {
  message: IncomingMessage;
  command: ParsedCommand;
  workspaceMode: WorkspaceMode;
}): UserIntent {
  const { command, workspaceMode } = input;

  if (command.kind === "none") return { kind: "noop" };
  if (command.kind === "new") return { kind: "session.reset" };
  if (command.kind === "status") return { kind: "reply.status" };
  if (command.kind === "resume") return { kind: "workspace.resume" };
  if (command.kind === "mode") return { kind: "workspace.mode", mode: command.reset ? undefined : command.mode };
  if (command.kind === "cwd") return { kind: "workspace.cwd", path: command.path };
  if (command.kind === "run") return { kind: "workspace.command", command: "run", value: command.command };
  if (command.kind === "test") return { kind: "workspace.command", command: "test", value: command.target };
  if (command.kind === "diff") return { kind: "workspace.command", command: "diff" };
  if (command.kind === "files") return { kind: "workspace.command", command: "files" };
  if (command.kind === "logs") return { kind: "workspace.command", command: "logs" };
  if (command.kind === "branch") return { kind: "workspace.command", command: "branch", value: command.name };
  if (command.kind === "apply") return { kind: "workspace.command", command: "apply" };
  if (command.kind === "abort") return { kind: "workspace.command", command: "abort" };
  if (command.kind === "model") return { kind: "reply.model" };
  if (command.kind === "think") return { kind: "reply.think" };

  return {
    kind: "task.start",
    taskKind: workspaceMode === "dev" ? "dev" : "chat",
    prompt: command.prompt,
  };
}
```

- [ ] **Step 4: Run the parser/router tests again and verify they pass**

Run: `npx vitest run tests/commands.spec.ts tests/router.spec.ts`

Expected: PASS with the new command variants parsing cleanly and dev-mode natural text routing to `task.start`.

- [ ] **Step 5: Commit the command and intent-routing layer**

```bash
git add src/bot/commands.ts src/bot/router.ts src/runtime/types.ts tests/commands.spec.ts tests/router.spec.ts
git commit -m "feat: add workspace intents and mode commands"
```

## Task 3: Build The Task Orchestrator And Stream Codex Progress

**Files:**
- Create: `src/runtime/progress.ts`
- Create: `src/runtime/orchestrator.ts`
- Create: `tests/orchestrator.spec.ts`
- Modify: `src/types/contracts.ts`
- Modify: `src/codex/types.ts`
- Modify: `src/codex/runner.ts`
- Modify: `tests/codex-runner.spec.ts`
- Test: `tests/orchestrator.spec.ts`
- Test: `tests/codex-runner.spec.ts`

- [ ] **Step 1: Write failing tests for progress callbacks and tracked task completion**

`tests/codex-runner.spec.ts`

```ts
it("emits normalized progress events while reading the json stream", async () => {
  const child = createFakeChild();
  const spawnFactory = vi.fn(() => child as any);
  const events: string[] = [];
  const runner = createCodexRunner(
    {
      codexBin: "codex",
      sandboxMode: "danger-full-access",
      defaultWorkdir: "C:\\tmp",
      timeoutMs: 1000,
    },
    spawnFactory as any,
  );

  setTimeout(() => {
    child.stdout.write('{"type":"item.started","item":{"type":"tool_call","description":"Read src/index.ts"}}\n');
    child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n');
    child.emit("close", 0);
  }, 10);

  await runner.run({
    sessionKey: "s1",
    prompt: "hello",
    workdir: "C:\\tmp",
    timeoutMs: 1000,
    onEvent: (event) => events.push(`${event.type}:${event.message ?? event.label ?? ""}`),
  });

  expect(events).toContain("tool.started:Read src/index.ts");
});
```

`tests/orchestrator.spec.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createTaskOrchestrator } from "../src/runtime/orchestrator.js";

describe("createTaskOrchestrator", () => {
  it("creates a task, stores progress, and completes it", async () => {
    const sessionStore = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(() => []),
      getSessionOptions: vi.fn(() => ({ model: "gpt-5", thinkingLevel: "medium" })),
    } as any;

    const runtimeStore = {
      saveWorkspaceState: vi.fn(),
      getWorkspaceState: vi.fn(() => ({
        sessionKey: "dm:ou_dev",
        mode: "dev",
        cwd: "D:\\My Project\\feishu-codex-bot",
        updatedAt: 1,
      })),
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      appendTaskEvent: vi.fn(),
      replaceTaskArtifacts: vi.fn(),
    } as any;

    const orchestrator = createTaskOrchestrator({
      logger: pino({ enabled: false }),
      config: {
        codexHistoryTurns: 20,
        codexTimeoutMs: 1000,
        codexWorkdir: "D:\\My Project\\feishu-codex-bot",
      } as any,
      sessionStore,
      runtimeStore,
      codexRunner: {
        run: vi.fn(async ({ onEvent }) => {
          onEvent?.({ type: "tool.started", label: "Read src/index.ts", message: "Read src/index.ts" });
          return { answer: "已完成", durationMs: 20 };
        }),
      },
    });

    const result = await orchestrator.startTask({
      sessionKey: "dm:ou_dev",
      chatId: "oc_dev",
      prompt: "修一下启动脚本",
      taskKind: "dev",
    });

    expect(result.text).toBe("已完成");
    expect(runtimeStore.createTask).toHaveBeenCalled();
    expect(runtimeStore.appendTaskEvent).toHaveBeenCalled();
    expect(runtimeStore.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({ summary: "已完成" }),
    );
  });
});
```

- [ ] **Step 2: Run the runtime tests and verify they fail**

Run: `npx vitest run tests/codex-runner.spec.ts tests/orchestrator.spec.ts`

Expected: FAIL because `CodexRunRequest` does not yet accept `onEvent`, the runner does not emit progress, and `createTaskOrchestrator` does not exist.

- [ ] **Step 3: Implement normalized Codex progress events and the runtime orchestrator**

`src/types/contracts.ts`

```ts
export type CodexStreamEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "tool.started"; label: string; message: string }
  | { type: "tool.completed"; label: string; message: string }
  | { type: "agent.message"; message: string }
  | { type: "turn.completed"; inputTokens?: number; outputTokens?: number };

export type CodexRunRequest = {
  sessionKey: string;
  prompt: string;
  workdir: string;
  timeoutMs: number;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  imagePaths?: string[];
  onEvent?: (event: CodexStreamEvent) => void;
  abortSignal?: AbortSignal;
};
```

`src/runtime/progress.ts`

```ts
import type { CodexStreamEvent } from "../types/contracts.js";

export function mapCodexEventToProgress(event: CodexStreamEvent): string | null {
  if (event.type === "tool.started") {
    return `处理中: ${event.label}`;
  }
  if (event.type === "tool.completed") {
    return `已完成步骤: ${event.label}`;
  }
  if (event.type === "turn.completed") {
    return `本轮完成: input=${event.inputTokens ?? 0}, output=${event.outputTokens ?? 0}`;
  }
  return null;
}
```

`src/codex/runner.ts`

```ts
function emitToolEvent(record: any, onEvent?: (event: CodexStreamEvent) => void): void {
  if (!onEvent || !record.item || record.item.type !== "tool_call") {
    return;
  }

  const label = String(record.item.description ?? record.item.name ?? "tool");
  if (record.type === "item.started") {
    onEvent({ type: "tool.started", label, message: label });
  }
  if (record.type === "item.completed") {
    onEvent({ type: "tool.completed", label, message: label });
  }
}

export function applyCodexJsonLine(
  line: string,
  state: CodexJsonState,
  onEvent?: (event: CodexStreamEvent) => void,
): void {
  if (!line.trim()) return;

  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  emitToolEvent(event, onEvent);

  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    state.threadId = event.thread_id;
    onEvent?.({ type: "thread.started", threadId: event.thread_id });
    return;
  }

  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    if (typeof event.item.text === "string" && event.item.text.trim().length > 0) {
      state.answer = event.item.text;
      onEvent?.({ type: "agent.message", message: event.item.text });
    }
    return;
  }

  if (event.type === "turn.completed") {
    state.usage = toUsage(event.usage);
    onEvent?.({
      type: "turn.completed",
      inputTokens: state.usage?.inputTokens,
      outputTokens: state.usage?.outputTokens,
    });
  }
}
```

`src/runtime/orchestrator.ts`

```ts
import { randomUUID } from "node:crypto";
import { buildPrompt } from "../codex/prompt-builder.js";
import { parseAssistantResponse } from "../codex/response-parser.js";
import { mapCodexEventToProgress } from "./progress.js";
import type { BotConfig } from "../types/config.js";
import type { SessionStore } from "../types/contracts.js";
import type { CodexRunner } from "../codex/types.js";
import type { RuntimeStore, TaskEventRecord, TaskKind } from "./types.js";
import type { Logger } from "pino";

export function createTaskOrchestrator(input: {
  logger: Logger;
  config: BotConfig;
  sessionStore: SessionStore;
  runtimeStore: RuntimeStore;
  codexRunner: CodexRunner;
}) {
  const { logger, config, sessionStore, runtimeStore, codexRunner } = input;

  return {
    async startTask(params: {
      sessionKey: string;
      chatId: string;
      prompt: string;
      taskKind: TaskKind;
      imagePaths?: string[];
    }) {
      const taskId = randomUUID();
      const now = Date.now();
      const abortController = new AbortController();
      activeAbortControllers.set(taskId, abortController);

      runtimeStore.createTask({
        id: taskId,
        sessionKey: params.sessionKey,
        kind: params.taskKind,
        title: params.prompt.slice(0, 60),
        inputText: params.prompt,
        status: "running",
        createdAt: now,
        startedAt: now,
      });

      runtimeStore.saveWorkspaceState({
        ...(runtimeStore.getWorkspaceState(params.sessionKey) ?? {
          sessionKey: params.sessionKey,
          mode: params.taskKind === "dev" ? "dev" : "chat",
          cwd: config.codexWorkdir,
          updatedAt: now,
        }),
        lastTaskId: taskId,
        updatedAt: now,
      });

      let seq = 1;
      const pushEvent = (phase: TaskEventRecord["phase"], message: string) => {
        runtimeStore.appendTaskEvent({
          taskId,
          seq,
          phase,
          message,
          createdAt: Date.now(),
        });
        seq += 1;
      };

      sessionStore.appendUser(params.sessionKey, params.prompt);
      pushEvent("queued", "任务已入队");

      const history = sessionStore.loadRecent(params.sessionKey, config.codexHistoryTurns);
      const prompt = buildPrompt({ sessionKey: params.sessionKey, history });

      const result = await codexRunner.run({
        sessionKey: params.sessionKey,
        prompt,
        workdir: runtimeStore.getWorkspaceState(params.sessionKey)?.cwd ?? config.codexWorkdir,
        timeoutMs: config.codexTimeoutMs,
        model: sessionStore.getSessionOptions(params.sessionKey).model ?? config.codexDefaultModel,
        reasoningEffort:
          sessionStore.getSessionOptions(params.sessionKey).thinkingLevel ?? config.codexDefaultThinkingLevel,
        imagePaths: params.imagePaths,
        abortSignal: abortController.signal,
        onEvent: (event) => {
          const message = mapCodexEventToProgress(event);
          if (message) {
            pushEvent("progress", message);
          }
        },
      });

      const parsed = parseAssistantResponse(result.answer, config.codexWorkdir);
      sessionStore.appendAssistant(params.sessionKey, parsed.text || result.answer);
      runtimeStore.updateTaskStatus(taskId, "completed", {
        summary: parsed.text || result.answer,
        finishedAt: Date.now(),
      });
      pushEvent("result", "任务完成");
      runtimeStore.replaceTaskArtifacts(taskId, []);
      activeAbortControllers.delete(taskId);

      logger.info({ taskId, durationMs: result.durationMs }, "task completed");

      return {
        taskId,
        text: parsed.text || result.answer,
        directives: parsed.directives,
      };
    },
  };
}
```

- [ ] **Step 4: Run the runtime tests again and verify they pass**

Run: `npx vitest run tests/codex-runner.spec.ts tests/orchestrator.spec.ts`

Expected: PASS with one test proving the runner emits `tool.started` progress and another proving the orchestrator records and completes a task.

- [ ] **Step 5: Commit the orchestrator and streaming runtime**

```bash
git add src/runtime/progress.ts src/runtime/orchestrator.ts src/types/contracts.ts src/codex/types.ts src/codex/runner.ts tests/codex-runner.spec.ts tests/orchestrator.spec.ts
git commit -m "feat: add tracked codex task runtime"
```

## Task 4: Refactor The Handler Around Router, Orchestrator, And Response Rendering

**Files:**
- Create: `src/bot/response-renderer.ts`
- Modify: `src/bot/handler.ts`
- Modify: `src/feishu/sender.ts`
- Modify: `tests/handler.spec.ts`
- Test: `tests/handler.spec.ts`

- [ ] **Step 1: Write failing handler tests for `/status`, `/resume`, and progress updates**

Add these cases to `tests/handler.spec.ts`:

```ts
it("renders workspace status with mode, cwd, and latest task", async () => {
  const store = new MemoryStore();
  store.workspace.set("dm:ou_allow", {
    sessionKey: "dm:ou_allow",
    mode: "dev",
    cwd: "D:\\My Project\\feishu-codex-bot",
    branch: "main",
    lastTaskId: "task_status",
    updatedAt: Date.now(),
  });
  store.tasks.set("task_status", {
    id: "task_status",
    sessionKey: "dm:ou_allow",
    kind: "dev",
    title: "Fix startup",
    inputText: "修复启动脚本",
    status: "interrupted",
    createdAt: Date.now(),
    errorSummary: "node exited",
  });

  await handler({
    messageId: "m_status",
    chatId: "oc_dm",
    chatType: "p2p",
    senderOpenId: "ou_allow",
    messageType: "text",
    text: "/status",
    mentionedBot: false,
    attachments: [],
  });

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining("模式: dev"),
      }),
    }),
  );
});

it("returns the last interrupted task on /resume", async () => {
  store.tasks.set("task_resume", {
    id: "task_resume",
    sessionKey: "dm:ou_allow",
    kind: "dev",
    title: "Resume me",
    inputText: "继续修复",
    status: "interrupted",
    createdAt: Date.now(),
    errorSummary: "process exited",
  });
  store.events.set("task_resume", [
    { taskId: "task_resume", seq: 1, phase: "progress", message: "Launching Codex", createdAt: Date.now() },
  ]);

  await handler({
    messageId: "m_resume",
    chatId: "oc_dm",
    chatType: "p2p",
    senderOpenId: "ou_allow",
    messageType: "text",
    text: "/resume",
    mentionedBot: false,
    attachments: [],
  });

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        content: expect.stringContaining("最近中断任务"),
      }),
    }),
  );
});
```

- [ ] **Step 2: Run the handler tests and verify they fail**

Run: `npx vitest run tests/handler.spec.ts`

Expected: FAIL because the in-memory test store does not yet expose runtime state, `/status` still renders the old queue-only format, and `/resume` is not handled.

- [ ] **Step 3: Implement the response renderer and wire the handler through the router/orchestrator**

`src/bot/response-renderer.ts`

```ts
import type { TaskEventRecord, TaskRecord, WorkspaceState } from "../runtime/types.js";

export function renderStatusReply(input: {
  workspace?: WorkspaceState;
  latestTask?: TaskRecord;
  queueLength: number;
  sandboxMode: string;
  timeoutMs: number;
}): string {
  const lines = [
    "机器人状态",
    `- 模式: ${input.workspace?.mode ?? "chat"}`,
    `- 工作目录: ${input.workspace?.cwd ?? "(未设置)"}`,
    `- 分支: ${input.workspace?.branch ?? "(未知)"}`,
    `- 队列长度: ${input.queueLength}`,
    `- 沙箱策略: ${input.sandboxMode}`,
    `- 超时: ${input.timeoutMs}ms`,
  ];

  if (input.latestTask) {
    lines.push(`- 最近任务: ${input.latestTask.title}`);
    lines.push(`- 任务状态: ${input.latestTask.status}`);
    if (input.latestTask.errorSummary) {
      lines.push(`- 最近错误: ${input.latestTask.errorSummary}`);
    }
  }

  return lines.join("\n");
}

export function renderProgressReply(event: TaskEventRecord): string {
  return `进行中 · ${event.message}`;
}

export function renderResumeReply(task: TaskRecord | undefined, events: TaskEventRecord[]): string {
  if (!task) {
    return "没有可恢复的最近任务。";
  }

  const lines = [
    "最近中断任务",
    `- 标题: ${task.title}`,
    `- 状态: ${task.status}`,
    `- 原因: ${task.errorSummary ?? "未知"}`,
  ];

  for (const event of events.slice(-3)) {
    lines.push(`- 进度: ${event.message}`);
  }

  return lines.join("\n");
}
```

`src/bot/handler.ts`

```ts
import { resolveIntent } from "./router.js";
import { renderProgressReply, renderResumeReply, renderStatusReply } from "./response-renderer.js";

const workspace = runtimeStore.getWorkspaceState(sessionKey);
const intent = resolveIntent({
  message,
  command,
  workspaceMode: workspace?.mode ?? "chat",
});

if (intent.kind === "reply.status") {
  await sendTextReply(
    deps,
    message,
    renderStatusReply({
      workspace,
      latestTask: workspace?.lastTaskId ? runtimeStore.getTask(workspace.lastTaskId) : undefined,
      queueLength: queue.getPendingCount(),
      sandboxMode: config.codexSandboxMode,
      timeoutMs: config.codexTimeoutMs,
    }),
  );
  return;
}

if (intent.kind === "workspace.resume") {
  const latestTask = workspace?.lastTaskId ? runtimeStore.getTask(workspace.lastTaskId) : undefined;
  const events = latestTask ? runtimeStore.loadTaskEvents(latestTask.id, 10) : [];
  await sendTextReply(deps, message, renderResumeReply(latestTask, events));
  return;
}

if (intent.kind === "task.start") {
  const result = await orchestrator.startTask({
    sessionKey,
    chatId: message.chatId,
    prompt: normalizedPrompt,
    taskKind: intent.taskKind,
    imagePaths,
  });

  const taskEvents = runtimeStore.loadTaskEvents(result.taskId, 10).filter((item) => item.phase === "progress");
  for (const event of taskEvents.slice(-3)) {
    await sendTextReply(deps, message, renderProgressReply(event));
  }

  await sendTextReply(deps, message, result.text);
  if (result.directives.length > 0) {
    await sendAssistantDirectives(deps, message, result.directives);
  }
  return;
}
```

- [ ] **Step 4: Run the handler tests again and verify they pass**

Run: `npx vitest run tests/handler.spec.ts`

Expected: PASS with `/status` and `/resume` returning the new workspace-oriented text and task execution still producing replies.

- [ ] **Step 5: Commit the handler refactor**

```bash
git add src/bot/response-renderer.ts src/bot/handler.ts src/feishu/sender.ts tests/handler.spec.ts
git commit -m "feat: render workspace status and progress"
```

## Task 5: Add Workspace Path Safety And Developer Control Commands

**Files:**
- Create: `src/workspace/path-policy.ts`
- Create: `src/workspace/command-runner.ts`
- Create: `tests/path-policy.spec.ts`
- Create: `tests/command-runner.spec.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/bot/handler.ts`
- Modify: `src/bot/response-renderer.ts`
- Modify: `src/runtime/types.ts`
- Test: `tests/path-policy.spec.ts`
- Test: `tests/command-runner.spec.ts`
- Test: `tests/handler.spec.ts`

- [ ] **Step 1: Write failing tests for workspace root validation and command execution**

`tests/path-policy.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/workspace/path-policy.js";

describe("resolveWorkspacePath", () => {
  it("allows paths under the workspace root", () => {
    expect(
      resolveWorkspacePath("D:\\My Project", "D:\\My Project\\feishu-codex-bot"),
    ).toBe("D:\\My Project\\feishu-codex-bot");
  });

  it("rejects paths outside the workspace root", () => {
    expect(() => resolveWorkspacePath("D:\\My Project", "C:\\Windows")).toThrow(
      /outside the configured workspace root/i,
    );
  });
});
```

`tests/command-runner.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { createWorkspaceCommandRunner } from "../src/workspace/command-runner.js";

describe("createWorkspaceCommandRunner", () => {
  it("captures stdout for a safe workspace command", async () => {
    const runner = createWorkspaceCommandRunner({
      shell: "powershell.exe",
      maxOutputChars: 4000,
    });

    const result = await runner.run({
      cwd: process.cwd(),
      command: 'Write-Output "workspace-ok"',
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("workspace-ok");
  });
});
```

- [ ] **Step 2: Run the workspace tests and verify they fail**

Run: `npx vitest run tests/path-policy.spec.ts tests/command-runner.spec.ts`

Expected: FAIL because neither `resolveWorkspacePath` nor `createWorkspaceCommandRunner` exists yet.

- [ ] **Step 3: Implement path enforcement and the command runner**

`src/workspace/path-policy.ts`

```ts
import path from "node:path";

export function isWithinWorkspaceRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function resolveWorkspacePath(root: string, candidate?: string): string {
  const nextPath = candidate ? path.resolve(candidate) : path.resolve(root);
  if (!isWithinWorkspaceRoot(root, nextPath)) {
    throw new Error(`Path ${nextPath} is outside the configured workspace root`);
  }
  return nextPath;
}
```

`src/workspace/command-runner.ts`

```ts
import { spawn } from "node:child_process";

export function createWorkspaceCommandRunner(options: {
  shell: string;
  maxOutputChars: number;
}) {
  return {
    run(input: { cwd: string; command: string; timeoutMs: number }) {
      return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(options.shell, ["-NoLogo", "-NoProfile", "-Command", input.command], {
          cwd: input.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error(`workspace command timed out after ${input.timeoutMs}ms`));
        }, input.timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout = (stdout + chunk.toString("utf8")).slice(-options.maxOutputChars);
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-options.maxOutputChars);
        });

        child.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });
      });
    },
  };
}
```

`src/runtime/orchestrator.ts`

```ts
const activeAbortControllers = new Map<string, AbortController>();
const workspaceCommandRunner = createWorkspaceCommandRunner({
  shell: "powershell.exe",
  maxOutputChars: 4000,
});

export async function handleWorkspaceCommand(params: {
  sessionKey: string;
  command: "run" | "test" | "diff" | "files" | "logs" | "branch" | "apply" | "abort";
  value?: string;
}) {
  const workspace = runtimeStore.getWorkspaceState(params.sessionKey);
  const cwd = resolveWorkspacePath(config.codexWorkdir, workspace?.cwd ?? config.codexWorkdir);

  if (params.command === "abort") {
    const taskId = workspace?.lastTaskId;
    if (taskId && activeAbortControllers.has(taskId)) {
      activeAbortControllers.get(taskId)?.abort();
      runtimeStore.updateTaskStatus(taskId, "interrupted", {
        errorSummary: "aborted from Feishu",
        finishedAt: Date.now(),
      });
      return { text: "已终止当前任务。", directives: [] };
    }
    return { text: "当前没有可终止的运行任务。", directives: [] };
  }

  const commandText =
    params.command === "run"
      ? params.value ?? ""
      : params.command === "test"
        ? params.value ? `npm test -- ${params.value}` : "npm test"
        : params.command === "diff"
          ? "git diff --stat --no-ext-diff"
          : params.command === "files"
            ? "git diff --name-only --no-ext-diff"
            : params.command === "logs"
              ? `Get-Content -Tail 80 "${path.join(config.logDir, "app.log")}"`
              : params.command === "branch"
                ? params.value
                  ? `git switch ${params.value} 2>$null; if ($LASTEXITCODE -ne 0) { git switch -c ${params.value} }`
                  : "git branch --show-current"
                : "";

  const result = await workspaceCommandRunner.run({
    cwd,
    command: commandText,
    timeoutMs: config.codexTimeoutMs,
  });

  return {
    text: result.exitCode === 0 ? result.stdout || "命令执行完成。" : result.stderr || result.stdout,
    directives: [],
  };
}
```

`src/bot/handler.ts`

```ts
if (intent.kind === "workspace.command") {
  const result = await orchestrator.handleWorkspaceCommand({
    sessionKey,
    command: intent.command,
    value: intent.value,
  });
  await sendTextReply(deps, message, result.text);
  return;
}
```

- [ ] **Step 4: Run the workspace and handler tests again and verify they pass**

Run: `npx vitest run tests/path-policy.spec.ts tests/command-runner.spec.ts tests/handler.spec.ts`

Expected: PASS with path validation rejecting out-of-root paths and workspace commands producing bounded output inside the active workspace.

- [ ] **Step 5: Commit the workspace command layer**

```bash
git add src/workspace/path-policy.ts src/workspace/command-runner.ts src/runtime/orchestrator.ts src/bot/handler.ts src/bot/response-renderer.ts src/runtime/types.ts tests/path-policy.spec.ts tests/command-runner.spec.ts tests/handler.spec.ts
git commit -m "feat: add workspace control commands"
```

## Task 6: Add Supervisor Startup Hardening, Health Snapshots, And Updated Ops Docs

**Files:**
- Create: `src/runtime/supervisor.ts`
- Create: `tests/supervisor.spec.ts`
- Create: `scripts/install-startup-task.ps1`
- Modify: `src/types/config.ts`
- Modify: `src/config.ts`
- Modify: `src/health/server.ts`
- Modify: `src/index.ts`
- Modify: `start-bot.ps1`
- Modify: `ecosystem.config.cjs`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/ops-checklist.md`
- Modify: `docs/test-report.md`
- Test: `tests/supervisor.spec.ts`
- Test: `tests/config.spec.ts`

- [ ] **Step 1: Write failing tests for supervisor preflight and richer health snapshots**

`tests/supervisor.spec.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createAppSupervisor } from "../src/runtime/supervisor.js";

describe("createAppSupervisor", () => {
  it("fails preflight when codex is missing", async () => {
    const supervisor = createAppSupervisor({
      logger: pino({ enabled: false }),
      config: {
        codexBin: "missing-codex",
        logDir: "D:\\My Project\\feishu-codex-bot\\logs",
        supervisorMaxRestarts: 3,
        supervisorRestartDelayMs: 1000,
      } as any,
      verifyBinary: vi.fn(async () => false),
      startApplication: vi.fn(),
    });

    await expect(supervisor.start()).rejects.toThrow(/codex/i);
  });
});
```

Add this assertion to `tests/config.spec.ts`:

```ts
expect(loadConfig({
  ...process.env,
  FEISHU_APP_ID: "cli_x",
  FEISHU_APP_SECRET: "secret",
  LOG_DIR: "./logs",
  SUPERVISOR_MAX_RESTARTS: "5",
  SUPERVISOR_RESTART_DELAY_MS: "3000",
})).toMatchObject({
  logDir: expect.stringContaining("logs"),
  supervisorMaxRestarts: 5,
  supervisorRestartDelayMs: 3000,
});
```

- [ ] **Step 2: Run the supervisor/config tests and verify they fail**

Run: `npx vitest run tests/supervisor.spec.ts tests/config.spec.ts`

Expected: FAIL because the supervisor does not exist and the config object has no `logDir` / restart settings yet.

- [ ] **Step 3: Implement the supervisor, config additions, startup script, and docs updates**

`src/types/config.ts`

```ts
export type BotConfig = {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: string;
  feishuAllowOpenIds: Set<string>;
  feishuRequireMention: boolean;
  feishuTriggerPrefix: "/ask";
  codexBin: string;
  codexWorkdir: string;
  codexSandboxMode: "danger-full-access";
  codexTimeoutMs: number;
  codexHistoryTurns: number;
  codexDefaultModel?: string;
  codexDefaultThinkingLevel: "low" | "medium" | "high";
  dbPath: string;
  logDir: string;
  logLevel: LogLevel;
  healthPort: number;
  replyChunkChars: number;
  dedupRetentionMs: number;
  supervisorMaxRestarts: number;
  supervisorRestartDelayMs: number;
};
```

`src/config.ts`

```ts
const envSchema = z.object({
  FEISHU_APP_ID: z.string().min(1, "FEISHU_APP_ID is required"),
  FEISHU_APP_SECRET: z.string().min(1, "FEISHU_APP_SECRET is required"),
  FEISHU_DOMAIN: z.string().default("feishu"),
  FEISHU_ALLOW_OPEN_IDS: z.string().default(""),
  FEISHU_REQUIRE_MENTION: z.string().default("true"),
  FEISHU_TRIGGER_PREFIX: z.string().default("/ask"),
  CODEX_BIN: z.string().default("codex"),
  CODEX_WORKDIR: z.string().default(path.join(homedir(), ".codex", "feishu-codex-bot", "workspace")),
  CODEX_SANDBOX_MODE: z.string().default("danger-full-access"),
  CODEX_TIMEOUT_MS: z.string().default("120000"),
  CODEX_HISTORY_TURNS: z.string().default("20"),
  CODEX_DEFAULT_MODEL: z.string().default(""),
  CODEX_DEFAULT_THINKING_LEVEL: z.string().default("medium"),
  DB_PATH: z.string().default("./data/bot.sqlite"),
  LOG_DIR: z.string().default("./logs"),
  LOG_LEVEL: z.string().default("info"),
  HEALTH_PORT: z.string().default("8787"),
  SUPERVISOR_MAX_RESTARTS: z.string().default("5"),
  SUPERVISOR_RESTART_DELAY_MS: z.string().default("3000"),
});

return {
  feishuAppId: cfg.FEISHU_APP_ID,
  feishuAppSecret: cfg.FEISHU_APP_SECRET,
  feishuDomain: cfg.FEISHU_DOMAIN,
  feishuAllowOpenIds: parseAllowOpenIds(cfg.FEISHU_ALLOW_OPEN_IDS),
  feishuRequireMention: parseBoolean(cfg.FEISHU_REQUIRE_MENTION, "FEISHU_REQUIRE_MENTION"),
  feishuTriggerPrefix: "/ask",
  codexBin: cfg.CODEX_BIN,
  codexWorkdir: path.resolve(cfg.CODEX_WORKDIR),
  codexSandboxMode: "danger-full-access",
  codexTimeoutMs: parsePositiveInt(cfg.CODEX_TIMEOUT_MS, "CODEX_TIMEOUT_MS"),
  codexHistoryTurns: parsePositiveInt(cfg.CODEX_HISTORY_TURNS, "CODEX_HISTORY_TURNS"),
  codexDefaultModel: cfg.CODEX_DEFAULT_MODEL.trim() || undefined,
  codexDefaultThinkingLevel: parseThinkingLevel(cfg.CODEX_DEFAULT_THINKING_LEVEL, "CODEX_DEFAULT_THINKING_LEVEL"),
  dbPath: path.resolve(cfg.DB_PATH),
  logDir: path.resolve(cfg.LOG_DIR),
  logLevel: parseLogLevel(cfg.LOG_LEVEL),
  healthPort: parsePositiveInt(cfg.HEALTH_PORT, "HEALTH_PORT"),
  replyChunkChars: 3200,
  dedupRetentionMs: 7 * 24 * 60 * 60 * 1000,
  supervisorMaxRestarts: parsePositiveInt(cfg.SUPERVISOR_MAX_RESTARTS, "SUPERVISOR_MAX_RESTARTS"),
  supervisorRestartDelayMs: parsePositiveInt(cfg.SUPERVISOR_RESTART_DELAY_MS, "SUPERVISOR_RESTART_DELAY_MS"),
};
```

`src/runtime/supervisor.ts`

```ts
import fs from "node:fs";
import type { BotConfig } from "../types/config.js";
import type { Logger } from "pino";

export function createAppSupervisor(input: {
  logger: Logger;
  config: BotConfig;
  verifyBinary?: (value: string) => Promise<boolean>;
  startApplication: () => Promise<{ stop: () => Promise<void> }>;
}) {
  const verifyBinary =
    input.verifyBinary ??
    (async (value: string) => {
      try {
        await import("node:child_process").then(({ execFileSync }) => execFileSync(value, ["--version"], { stdio: "ignore" }));
        return true;
      } catch {
        return false;
      }
    });

  let restartCount = 0;
  let currentApp: { stop: () => Promise<void> } | undefined;
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
      }
    },
    markRestart(error: unknown): void {
      restartCount += 1;
      lastErrorAt = Date.now();
      input.logger.error({ err: error, restartCount }, "application restart requested");
    },
    getSnapshot(): { restartCount: number; lastErrorAt: number | null } {
      return { restartCount, lastErrorAt };
    },
  };
}
```

`scripts/install-startup-task.ps1`

```powershell
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "FeishuCodexWorkspaceBot"
$startScript = Join-Path $projectRoot "start-bot.ps1"

$action = New-ScheduledTaskAction `
  -Execute "PowerShell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start Feishu Codex Workspace bot at Windows startup" `
  -RunLevel Highest `
  -Force
```

`start-bot.ps1`

```powershell
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot "logs"
if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$stdout = Join-Path $logsDir "app.log"
$stderr = Join-Path $logsDir "app.err.log"

if (!(Test-Path (Join-Path $projectRoot "dist\\index.js"))) {
  npm.cmd run build
}

Start-Process `
  -FilePath "node.exe" `
  -ArgumentList "dist/index.js" `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden
```

- [ ] **Step 4: Run the final verification suite and verify the workspace bot still builds cleanly**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm test`

Expected: PASS with the legacy tests plus new runtime/router/command/supervisor tests green.

Run: `npm run build`

Expected: PASS and emit `dist/index.js`.

- [ ] **Step 5: Commit the supervisor, startup, and docs changes**

```bash
git add src/runtime/supervisor.ts tests/supervisor.spec.ts scripts/install-startup-task.ps1 src/types/config.ts src/config.ts src/health/server.ts src/index.ts start-bot.ps1 ecosystem.config.cjs .env.example README.md docs/ops-checklist.md docs/test-report.md tests/config.spec.ts
git commit -m "feat: harden startup and supervisor"
```

## Self-Review Checklist

### Spec Coverage

- Task 1 covers the data model changes for workspace state, tasks, task events, and artifacts.
- Task 2 covers the hybrid command surface and mode-aware intent routing.
- Task 3 covers tracked task lifecycle, progress emission, and resumable runtime state.
- Task 4 covers response rendering, `/status`, `/resume`, and the handler split into router/orchestrator/renderer responsibilities.
- Task 5 covers workspace root safety and the explicit developer control commands `/cwd`, `/run`, `/test`, `/diff`, `/files`, `/logs`, `/branch`, `/apply`, and `/abort`.
- Task 6 covers the two-layer startup model, supervisor hardening, health snapshots, and the required operations/docs updates.

### Placeholder Scan

- No placeholder markers remain.
- Every task includes explicit file paths, code snippets, run commands, expected results, and a commit step.

### Type Consistency

- `WorkspaceMode` is consistently `chat | dev`.
- `TaskStatus` is consistently `queued | running | waiting_for_input | interrupted | failed | completed | resumable`.
- Store method names are consistently `saveWorkspaceState`, `getWorkspaceState`, `createTask`, `getTask`, `listRecentTasks`, `updateTaskStatus`, `appendTaskEvent`, `loadTaskEvents`, `replaceTaskArtifacts`, and `listTaskArtifacts`.
- Router intent names are consistently `task.start`, `workspace.mode`, `workspace.resume`, `workspace.cwd`, `workspace.command`, `reply.status`, `reply.model`, `reply.think`, `session.reset`, and `noop`.
