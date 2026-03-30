import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createTaskOrchestrator } from "../src/runtime/orchestrator.js";
import type { CodexRunner } from "../src/codex/types.js";
import type { RuntimeStore } from "../src/runtime/types.js";
import type { BotConfig } from "../src/types/config.js";
import type { CodexRunRequest, SessionMessage, SessionOptions, SessionStore } from "../src/types/contracts.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  tempPaths.length = 0;
});

function makeConfig(): BotConfig {
  return {
    feishuAppId: "cli",
    feishuAppSecret: "secret",
    feishuDomain: "feishu",
    feishuAllowOpenIds: new Set(["ou_allow"]),
    feishuRequireMention: true,
    feishuTriggerPrefix: "/ask",
    codexBin: "codex",
    codexWorkdir: "C:\\tmp",
    codexSandboxMode: "danger-full-access",
    codexTimeoutMs: 1000,
    codexHistoryTurns: 20,
    codexDefaultModel: "gpt-5",
    codexDefaultThinkingLevel: "medium",
    dbPath: "./data/test.sqlite",
    logLevel: "info",
    healthPort: 8787,
    replyChunkChars: 3200,
    dedupRetentionMs: 1000,
  };
}

function makeConfigWithWorkdir(workdir: string): BotConfig {
  return {
    ...makeConfig(),
    codexWorkdir: workdir,
  };
}

describe("createTaskOrchestrator", () => {
  it("records streamed progress and creates tracked tasks with the requested initial shape", async () => {
    const sessionOptions: SessionOptions = {
      model: "gpt-5",
      thinkingLevel: "high",
    };
    const prompt =
      " 012345678901234567890123456789012345678901234567890123456789-extra-tail";

    const sessionStore: Pick<
      SessionStore,
      "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions"
    > = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(
        (): SessionMessage[] => [
          { role: "user", content: "review repo" },
        ],
      ),
      getSessionOptions: vi.fn(() => sessionOptions),
    };

    const runtimeStore: Pick<
      RuntimeStore,
      | "saveWorkspaceState"
      | "getWorkspaceState"
      | "createTask"
      | "updateTaskStatus"
      | "appendTaskEvent"
      | "replaceTaskArtifacts"
    > = {
      saveWorkspaceState: vi.fn(),
      getWorkspaceState: vi.fn(() => undefined),
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      appendTaskEvent: vi.fn(),
      replaceTaskArtifacts: vi.fn(),
    };

    const codexRunner: CodexRunner = {
      run: vi.fn(async (request: CodexRunRequest) => {
        request.onEvent?.({
          type: "tool.started",
          label: "Read src/index.ts",
          message: "Read src/index.ts",
        });
        return { answer: "\u5df2\u5b8c\u6210", durationMs: 20 };
      }),
    };

    const orchestrator = createTaskOrchestrator({
      logger: pino({ enabled: false }),
      config: makeConfig(),
      sessionStore,
      runtimeStore,
      codexRunner,
    });

    const result = await orchestrator.startTask({
      sessionKey: "dm:ou_allow",
      chatId: "oc_1",
      prompt,
      taskKind: "dev",
    });

    expect(result.text).toBe("\u5df2\u5b8c\u6210");
    expect(runtimeStore.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: prompt.slice(0, 60),
        status: "running",
        startedAt: expect.any(Number),
      }),
    );
    expect(runtimeStore.appendTaskEvent).toHaveBeenCalled();
    expect(runtimeStore.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({
        summary: "\u5df2\u5b8c\u6210",
        finishedAt: expect.any(Number),
      }),
    );
  });

  it("marks a partially created task failed when setup throws before codex run", async () => {
    const sessionStore: Pick<
      SessionStore,
      "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions"
    > = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(() => []),
      getSessionOptions: vi.fn((): SessionOptions => ({})),
    };

    const runtimeStore: Pick<
      RuntimeStore,
      | "saveWorkspaceState"
      | "getWorkspaceState"
      | "createTask"
      | "updateTaskStatus"
      | "appendTaskEvent"
      | "replaceTaskArtifacts"
    > = {
      saveWorkspaceState: vi.fn(() => {
        throw new Error("workspace save failed");
      }),
      getWorkspaceState: vi.fn(() => undefined),
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      appendTaskEvent: vi.fn(),
      replaceTaskArtifacts: vi.fn(),
    };

    const codexRunner: CodexRunner = {
      run: vi.fn(),
    };

    const orchestrator = createTaskOrchestrator({
      logger: pino({ enabled: false }),
      config: makeConfig(),
      sessionStore,
      runtimeStore,
      codexRunner,
    });

    await expect(
      orchestrator.startTask({
        sessionKey: "dm:ou_allow",
        chatId: "oc_1",
        prompt: "setup failure",
        taskKind: "dev",
      }),
    ).rejects.toThrow("workspace save failed");

    expect(runtimeStore.createTask).toHaveBeenCalled();
    expect(runtimeStore.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      "failed",
      expect.objectContaining({
        finishedAt: expect.any(Number),
        errorSummary: "workspace save failed",
      }),
    );
    expect(runtimeStore.replaceTaskArtifacts).toHaveBeenCalledWith(expect.any(String), []);
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an existing workspace state when saving lastTaskId for a non-dev task", async () => {
    const sessionStore: Pick<
      SessionStore,
      "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions"
    > = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(
        (): SessionMessage[] => [
          { role: "user", content: "resume chat" },
        ],
      ),
      getSessionOptions: vi.fn((): SessionOptions => ({})),
    };

    const existingState = {
      sessionKey: "dm:ou_allow",
      mode: "dev" as const,
      cwd: "D:\\repo\\custom",
      branch: "feature/runtime",
      lastTaskId: "old-task",
      lastErrorSummary: "previous warning",
      updatedAt: 100,
    };

    const runtimeStore: Pick<
      RuntimeStore,
      | "saveWorkspaceState"
      | "getWorkspaceState"
      | "createTask"
      | "updateTaskStatus"
      | "appendTaskEvent"
      | "replaceTaskArtifacts"
    > = {
      saveWorkspaceState: vi.fn(),
      getWorkspaceState: vi.fn(() => existingState),
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      appendTaskEvent: vi.fn(),
      replaceTaskArtifacts: vi.fn(),
    };

    const codexRunner: CodexRunner = {
      run: vi.fn(async () => ({ answer: "\u5df2\u5b8c\u6210", durationMs: 20 })),
    };

    const orchestrator = createTaskOrchestrator({
      logger: pino({ enabled: false }),
      config: makeConfig(),
      sessionStore,
      runtimeStore,
      codexRunner,
    });

    await orchestrator.startTask({
      sessionKey: "dm:ou_allow",
      chatId: "oc_1",
      prompt: "resume chat",
      taskKind: "chat",
    });

    expect(runtimeStore.saveWorkspaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: existingState.sessionKey,
        mode: existingState.mode,
        cwd: existingState.cwd,
        branch: existingState.branch,
        lastErrorSummary: existingState.lastErrorSummary,
        lastTaskId: expect.any(String),
        updatedAt: expect.any(Number),
      }),
    );
  });

  it("does not leak directive markup into returned text, history, or summary", async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-codex-orchestrator-"));
    tempPaths.push(workdir);
    const filePath = path.join(workdir, "artifact.txt");
    fs.writeFileSync(filePath, "artifact");

    const sessionStore: Pick<
      SessionStore,
      "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions"
    > = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(
        (): SessionMessage[] => [
          { role: "user", content: "send file" },
        ],
      ),
      getSessionOptions: vi.fn((): SessionOptions => ({})),
    };

    const runtimeStore: Pick<
      RuntimeStore,
      | "saveWorkspaceState"
      | "getWorkspaceState"
      | "createTask"
      | "updateTaskStatus"
      | "appendTaskEvent"
      | "replaceTaskArtifacts"
    > = {
      saveWorkspaceState: vi.fn(),
      getWorkspaceState: vi.fn(() => undefined),
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      appendTaskEvent: vi.fn(),
      replaceTaskArtifacts: vi.fn(),
    };

    const codexRunner: CodexRunner = {
      run: vi.fn(async () => ({
        answer: '<send_file path="artifact.txt" />',
        durationMs: 20,
      })),
    };

    const orchestrator = createTaskOrchestrator({
      logger: pino({ enabled: false }),
      config: makeConfigWithWorkdir(workdir),
      sessionStore,
      runtimeStore,
      codexRunner,
    });

    const result = await orchestrator.startTask({
      sessionKey: "dm:ou_allow",
      chatId: "oc_1",
      prompt: "send file",
      taskKind: "chat",
    });

    expect(result.text).toBe("");
    expect(result.directives).toEqual([
      {
        type: "file",
        path: filePath,
      },
    ]);
    expect(sessionStore.appendAssistant).toHaveBeenCalledWith(
      "dm:ou_allow",
      "[assistant_sent_attachments]: 1",
    );
    expect(runtimeStore.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({
        summary: undefined,
      }),
    );
  });
});
