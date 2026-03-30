import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createTaskOrchestrator } from "../src/runtime/orchestrator.js";
import type { CodexRunner } from "../src/codex/types.js";
import type { RuntimeStore } from "../src/runtime/types.js";
import type { BotConfig } from "../src/types/config.js";
import type { CodexRunRequest, SessionMessage, SessionOptions, SessionStore } from "../src/types/contracts.js";

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
});
