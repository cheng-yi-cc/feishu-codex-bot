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
  it("records streamed progress and completes tracked tasks", async () => {
    const sessionOptions: SessionOptions = {
      model: "gpt-5",
      thinkingLevel: "high",
    };

    const sessionStore: Pick<
      SessionStore,
      "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions"
    > = {
      appendUser: vi.fn(),
      appendAssistant: vi.fn(),
      loadRecent: vi.fn(
        (): SessionMessage[] => [
          { role: "user", content: "请检查仓库" },
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
          return { answer: "已完成", durationMs: 20 };
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
      prompt: "请检查仓库",
      taskKind: "dev",
    });

    expect(result.text).toBe("已完成");
    expect(runtimeStore.createTask).toHaveBeenCalled();
    expect(runtimeStore.appendTaskEvent).toHaveBeenCalled();
    expect(runtimeStore.updateTaskStatus).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({
        summary: "已完成",
        finishedAt: expect.any(Number),
      }),
    );
  });
});
