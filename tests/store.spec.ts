import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { openSessionDatabase } from "../src/session/migrations.js";
import { SQLiteSessionStore } from "../src/session/store.js";

describe("SQLiteSessionStore", () => {
  it("stores and loads recent chat history", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-test-${Date.now()}.sqlite`);
    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    store.appendUser("dm:ou_a", "u1");
    store.appendAssistant("dm:ou_a", "a1");
    store.appendUser("dm:ou_a", "u2");

    const history = store.loadRecent("dm:ou_a", 2);
    expect(history).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);

    store.resetSession("dm:ou_a");
    expect(store.loadRecent("dm:ou_a", 2)).toEqual([]);
    expect(store.getWorkspaceState("dm:ou_a")).toBeUndefined();
    expect(store.listRecentTasks("dm:ou_a", 5)).toEqual([]);

    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("deduplicates message ids", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-test-${Date.now()}-dup.sqlite`);
    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    expect(store.isDuplicate("m1")).toBe(false);
    expect(store.isDuplicate("m1")).toBe(true);

    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("stores session model and thinking options", () => {
    const dbPath = path.join(os.tmpdir(), `feishu-codex-test-${Date.now()}-options.sqlite`);
    const db = openSessionDatabase(dbPath);
    const store = new SQLiteSessionStore(db, {
      dedupRetentionMs: 1000,
      logger: pino({ enabled: false }),
    });

    store.setSessionModel("dm:ou_a", "gpt-5-mini");
    store.setSessionThinkingLevel("dm:ou_a", "high");
    expect(store.getSessionOptions("dm:ou_a")).toEqual({
      model: "gpt-5-mini",
      thinkingLevel: "high",
    });

    store.setSessionModel("dm:ou_a", undefined);
    expect(store.getSessionOptions("dm:ou_a")).toEqual({
      model: undefined,
      thinkingLevel: "high",
    });

    db.close();
    fs.rmSync(dbPath, { force: true });
  });
});
