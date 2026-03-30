import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createMessageHandler } from "../src/bot/handler.js";
import { SerialTaskQueue } from "../src/bot/queue.js";
import type {
  RuntimeStore,
  TaskArtifactRecord,
  TaskEventRecord,
  TaskRecord,
  WorkspaceState,
} from "../src/runtime/types.js";
import type { BotConfig } from "../src/types/config.js";
import type { SessionMessage, SessionOptions, SessionStore } from "../src/types/contracts.js";

class MemoryStore implements SessionStore, RuntimeStore {
  public readonly dedup = new Set<string>();
  public readonly sessions = new Map<string, SessionMessage[]>();
  public readonly options = new Map<string, SessionOptions>();
  public readonly workspace = new Map<string, WorkspaceState>();
  public readonly tasks = new Map<string, TaskRecord>();
  public readonly events = new Map<string, TaskEventRecord[]>();
  public readonly artifacts = new Map<string, TaskArtifactRecord[]>();

  public isDuplicate(messageId: string): boolean {
    if (this.dedup.has(messageId)) return true;
    this.dedup.add(messageId);
    return false;
  }

  public appendUser(sessionKey: string, content: string): void {
    this.append(sessionKey, "user", content);
  }

  public appendAssistant(sessionKey: string, content: string): void {
    this.append(sessionKey, "assistant", content);
  }

  public loadRecent(sessionKey: string): SessionMessage[] {
    return [...(this.sessions.get(sessionKey) ?? [])];
  }

  public resetSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
    this.options.delete(sessionKey);
    this.workspace.delete(sessionKey);
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.sessionKey === sessionKey) {
        this.tasks.delete(taskId);
        this.events.delete(taskId);
        this.artifacts.delete(taskId);
      }
    }
  }

  public getSessionOptions(sessionKey: string): SessionOptions {
    return { ...(this.options.get(sessionKey) ?? {}) };
  }

  public setSessionModel(sessionKey: string, model?: string): void {
    const current = this.options.get(sessionKey) ?? {};
    this.options.set(sessionKey, { ...current, model });
  }

  public setSessionThinkingLevel(sessionKey: string, thinkingLevel?: "low" | "medium" | "high"): void {
    const current = this.options.get(sessionKey) ?? {};
    this.options.set(sessionKey, { ...current, thinkingLevel });
  }

  public saveWorkspaceState(state: WorkspaceState): void {
    this.workspace.set(state.sessionKey, state);
  }

  public getWorkspaceState(sessionKey: string): WorkspaceState | undefined {
    return this.workspace.get(sessionKey);
  }

  public createTask(task: TaskRecord): void {
    this.tasks.set(task.id, task);
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  public listRecentTasks(sessionKey: string, limit: number): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((task) => task.sessionKey === sessionKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  }

  public updateTaskStatus(
    taskId: string,
    status: TaskRecord["status"],
    updates: Partial<Pick<TaskRecord, "startedAt" | "finishedAt" | "summary" | "errorSummary">> = {},
  ): void {
    const current = this.tasks.get(taskId);
    if (!current) {
      return;
    }
    this.tasks.set(taskId, { ...current, status, ...updates });
  }

  public appendTaskEvent(event: TaskEventRecord): void {
    const current = this.events.get(event.taskId) ?? [];
    current.push(event);
    this.events.set(event.taskId, current);
  }

  public loadTaskEvents(taskId: string, limit: number): TaskEventRecord[] {
    return [...(this.events.get(taskId) ?? [])].slice(-Math.max(1, limit));
  }

  public replaceTaskArtifacts(taskId: string, artifacts: TaskArtifactRecord[]): void {
    this.artifacts.set(taskId, [...artifacts]);
  }

  public listTaskArtifacts(taskId: string): TaskArtifactRecord[] {
    return [...(this.artifacts.get(taskId) ?? [])];
  }

  private append(sessionKey: string, role: "user" | "assistant", content: string): void {
    const list = this.sessions.get(sessionKey) ?? [];
    list.push({ role, content });
    this.sessions.set(sessionKey, list);
  }
}

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

describe("createMessageHandler", () => {
  it("rejects non-whitelisted sender", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "ignored", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m1",
      chatId: "oc_1",
      chatType: "p2p",
      senderOpenId: "ou_blocked",
      messageType: "text",
      text: "/ask hi",
      mentionedBot: false,
      attachments: [],
    });

    expect(reply.mock.calls.length + create.mock.calls.length).toBeGreaterThan(0);
  });

  it("allows all users when whitelist is empty", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));
    const run = vi.fn(async () => ({ answer: "ok", durationMs: 1 }));

    const handler = createMessageHandler({
      config: {
        ...makeConfig(),
        feishuAllowOpenIds: new Set<string>(),
      },
      logger: pino({ enabled: false }),
      store,
      codexRunner: { run },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m1-empty-whitelist",
      chatId: "oc_1",
      chatType: "p2p",
      senderOpenId: "ou_anyone",
      messageType: "text",
      text: "/ask hi",
      mentionedBot: false,
      attachments: [],
    });

    expect(run).toHaveBeenCalled();
    expect(reply.mock.calls.length + create.mock.calls.length).toBeGreaterThan(0);
  });

  it("handles /ask and appends history", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "你好", durationMs: 10 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m2",
      chatId: "oc_2",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/ask 帮我总结",
      mentionedBot: false,
      attachments: [],
    });

    expect(store.loadRecent("dm:ou_allow")).toEqual([
      { role: "user", content: "帮我总结" },
      { role: "assistant", content: "你好" },
    ]);
    expect(reply.mock.calls.length + create.mock.calls.length).toBeGreaterThan(0);
  });

  it("renders workspace status with mode, cwd, and latest task", async () => {
    const store = new MemoryStore();
    store.saveWorkspaceState({
      sessionKey: "dm:ou_allow",
      mode: "dev",
      cwd: "D:\\My Project\\feishu-codex-bot",
      branch: "main",
      lastTaskId: "task_status",
      lastErrorSummary: undefined,
      updatedAt: Date.now(),
    });
    store.createTask({
      id: "task_status",
      sessionKey: "dm:ou_allow",
      kind: "dev",
      title: "Fix startup",
      inputText: "修复启动脚本",
      status: "interrupted",
      createdAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      summary: undefined,
      errorSummary: "node exited",
    });

    const queue = new SerialTaskQueue();
    const create = vi.fn(async () => ({ code: 0 }));
    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "unused", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
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
    const store = new MemoryStore();
    store.saveWorkspaceState({
      sessionKey: "dm:ou_allow",
      mode: "dev",
      cwd: "D:\\My Project\\feishu-codex-bot",
      branch: "main",
      lastTaskId: "task_resume",
      lastErrorSummary: undefined,
      updatedAt: Date.now(),
    });
    store.createTask({
      id: "task_resume",
      sessionKey: "dm:ou_allow",
      kind: "dev",
      title: "Resume me",
      inputText: "继续修复",
      status: "interrupted",
      createdAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      summary: undefined,
      errorSummary: "process exited",
    });
    store.appendTaskEvent({
      taskId: "task_resume",
      seq: 1,
      phase: "progress",
      message: "Launching Codex",
      createdAt: Date.now(),
    });

    const queue = new SerialTaskQueue();
    const create = vi.fn(async () => ({ code: 0 }));
    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "unused", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

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

  it("renders progress updates after a task starts", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "done", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    vi.spyOn(store, "loadTaskEvents").mockReturnValue([
      {
        taskId: "task_progress",
        seq: 1,
        phase: "progress",
        message: "Launching Codex",
        createdAt: Date.now(),
      },
      {
        taskId: "task_progress",
        seq: 2,
        phase: "progress",
        message: "Inspecting files",
        createdAt: Date.now(),
      },
    ]);

    await handler({
      messageId: "m_progress",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/ask 修复启动",
      mentionedBot: false,
      attachments: [],
    });

    const recordedCalls = create.mock.calls as unknown as Array<[unknown]>;
    expect(
      recordedCalls.some((call) => {
        const options = call[0] as { data?: { content?: string } };
        const content = options.data?.content ?? "";
        return content.includes("进行中");
      }),
    ).toBe(true);
  });

  it("treats plain p2p text as ask prompt", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const create = vi.fn(async () => ({ code: 0 }));
    const run = vi.fn(async () => ({ answer: "收到", durationMs: 8 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: { run },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_plain_dm",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "直接问，不加命令",
      mentionedBot: false,
      attachments: [],
    });

    expect(run).toHaveBeenCalled();
    expect(store.loadRecent("dm:ou_allow")).toEqual([
      { role: "user", content: "直接问，不加命令" },
      { role: "assistant", content: "收到" },
    ]);
    expect(create).toHaveBeenCalled();
  });

  it("adds and removes typing reaction around ask handling", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reactionCreate = vi.fn(async () => ({ code: 0, data: { reaction_id: "r_1" } }));
    const reactionDelete = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "typing test", durationMs: 12 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
          messageReaction: {
            create: reactionCreate,
            delete: reactionDelete,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_typing",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "测试 typing",
      mentionedBot: false,
      attachments: [],
    });

    expect(reactionCreate).toHaveBeenCalledWith({
      path: { message_id: "m_typing" },
      data: {
        reaction_type: { emoji_type: "Typing" },
      },
    });
    expect(reactionDelete).toHaveBeenCalledWith({
      path: {
        message_id: "m_typing",
        reaction_id: "r_1",
      },
    });
    expect(create).toHaveBeenCalled();
  });

  it("treats plain mentioned group text as ask prompt", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const run = vi.fn(async () => ({ answer: "group ok", durationMs: 4 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: { run },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create: vi.fn(async () => ({ code: 0 })),
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_group_plain",
      chatId: "oc_group",
      chatType: "group",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "群聊直接提问",
      mentionedBot: true,
      attachments: [],
    });

    expect(run).toHaveBeenCalled();
    expect(store.loadRecent("group:oc_group")).toEqual([
      { role: "user", content: "群聊直接提问" },
      { role: "assistant", content: "group ok" },
    ]);
    expect(reply).toHaveBeenCalled();
  });

  it("updates session model and thinking level through commands", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const create = vi.fn(async () => ({ code: 0 }));
    const run = vi.fn(async () => ({ answer: "ok", durationMs: 2 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: { run },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_model",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/model gpt-5-mini",
      mentionedBot: false,
      attachments: [],
    });
    await handler({
      messageId: "m_think",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/think high",
      mentionedBot: false,
      attachments: [],
    });
    await handler({
      messageId: "m_ask_after_setting",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "继续",
      mentionedBot: false,
      attachments: [],
    });

    expect(store.getSessionOptions("dm:ou_allow")).toEqual({
      model: "gpt-5-mini",
      thinkingLevel: "high",
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-mini",
        reasoningEffort: "high",
      }),
    );
    expect(create).toHaveBeenCalled();
  });

  it("responds to invalid /think argument instead of ignoring", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "unused", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_think_invalid",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/think <ultra>",
      mentionedBot: false,
      attachments: [],
    });

    expect(create).toHaveBeenCalled();
  });

  it("falls back to default model when configured model is unsupported", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    store.setSessionModel("dm:ou_allow", "bad-model");

    const create = vi.fn(async () => ({ code: 0 }));
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("The 'bad-model' model is not supported"))
      .mockResolvedValueOnce({ answer: "fallback ok", durationMs: 5 });

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: { run },
      queue,
      feishuClient: {
        im: {
          message: {
            reply: vi.fn(async () => ({ code: 0 })),
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m_fallback_model",
      chatId: "oc_dm",
      chatType: "p2p",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "你好",
      mentionedBot: false,
      attachments: [],
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ model: "bad-model" });
    expect(run.mock.calls[1]?.[0]).toMatchObject({ model: "gpt-5" });
    expect(store.getSessionOptions("dm:ou_allow").model).toBeUndefined();
    expect(create).toHaveBeenCalled();
  });

  it("ignores group ask without mention when requireMention=true", async () => {
    const store = new MemoryStore();
    const queue = new SerialTaskQueue();
    const reply = vi.fn(async () => ({ code: 0 }));
    const create = vi.fn(async () => ({ code: 0 }));

    const handler = createMessageHandler({
      config: makeConfig(),
      logger: pino({ enabled: false }),
      store,
      codexRunner: {
        run: vi.fn(async () => ({ answer: "x", durationMs: 1 })),
      },
      queue,
      feishuClient: {
        im: {
          message: {
            reply,
            create,
          },
        },
      } as any,
      runtimeStatus: { startedAt: Date.now(), lastErrorAt: null },
    });

    await handler({
      messageId: "m3",
      chatId: "oc_group",
      chatType: "group",
      senderOpenId: "ou_allow",
      messageType: "text",
      text: "/ask hi",
      mentionedBot: false,
      attachments: [],
    });

    expect(reply).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(store.loadRecent("group:oc_group")).toEqual([]);
  });
});
