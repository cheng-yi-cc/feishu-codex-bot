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
      inputText: "fix startup",
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

  it("clears runtime state when a session is reset", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-runtime-reset-${Date.now()}.sqlite`);
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
      lastErrorSummary: "boom",
      updatedAt: 100,
    });
    store.createTask({
      id: "task_1",
      sessionKey: "dm:ou_dev",
      kind: "dev",
      title: "Fix startup",
      inputText: "fix startup",
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

    store.resetSession("dm:ou_dev");

    expect(store.getWorkspaceState("dm:ou_dev")).toBeUndefined();
    expect(store.getTask("task_1")).toBeUndefined();
    expect(store.loadTaskEvents("task_1", 10)).toEqual([]);
    expect(store.listTaskArtifacts("task_1")).toEqual([]);

    db.close();
  });

  it("rejects orphan runtime child rows", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-runtime-orphan-${Date.now()}.sqlite`);
    tempPaths.push(dbPath);

    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    expect(() =>
      store.appendTaskEvent({
        taskId: "missing_task",
        seq: 1,
        phase: "error",
        message: "boom",
        createdAt: 101,
      }),
    ).toThrow();

    expect(() =>
      store.replaceTaskArtifacts("missing_task", [
        {
          taskId: "missing_task",
          kind: "log",
          label: "stderr",
          value: "logs/missing.stderr.log",
          createdAt: 102,
        },
      ]),
    ).toThrow();

    db.close();
  });

  it("clears optional task fields when explicitly requested", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-runtime-clear-${Date.now()}.sqlite`);
    tempPaths.push(dbPath);

    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    store.createTask({
      id: "task_1",
      sessionKey: "dm:ou_dev",
      kind: "dev",
      title: "Fix startup",
      inputText: "fix startup",
      status: "running",
      createdAt: 101,
      startedAt: 102,
      finishedAt: 103,
      summary: "initial summary",
      errorSummary: "initial error",
    });

    store.updateTaskStatus("task_1", "completed", {
      startedAt: undefined,
      finishedAt: undefined,
      summary: undefined,
      errorSummary: undefined,
    });

    expect(store.getTask("task_1")).toMatchObject({
      status: "completed",
      startedAt: undefined,
      finishedAt: undefined,
      summary: undefined,
      errorSummary: undefined,
    });

    db.close();
  });
});
