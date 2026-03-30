import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { buildPrompt } from "../codex/prompt-builder.js";
import { parseAssistantResponse, type OutgoingDirective } from "../codex/response-parser.js";
import type { CodexRunner } from "../codex/types.js";
import type { BotConfig } from "../types/config.js";
import type { SessionStore } from "../types/contracts.js";
import { mapCodexEventToProgress } from "./progress.js";
import type { RuntimeStore, TaskKind, TaskRecord, TaskEventPhase, WorkspaceState } from "./types.js";

type TaskOrchestratorDeps = {
  logger: Logger;
  config: BotConfig;
  sessionStore: Pick<SessionStore, "appendUser" | "appendAssistant" | "loadRecent" | "getSessionOptions">;
  runtimeStore: Pick<
    RuntimeStore,
    | "saveWorkspaceState"
    | "getWorkspaceState"
    | "createTask"
    | "updateTaskStatus"
    | "appendTaskEvent"
    | "replaceTaskArtifacts"
  >;
  codexRunner: CodexRunner;
};

export type StartTaskParams = {
  sessionKey: string;
  chatId: string;
  prompt: string;
  taskKind: TaskKind;
  imagePaths?: string[];
};

export type StartTaskResult = {
  taskId: string;
  text: string;
  directives: OutgoingDirective[];
};

const taskAbortControllers = new Map<string, AbortController>();

function resolveWorkspaceState(
  state: WorkspaceState | undefined,
  sessionKey: string,
  taskKind: TaskKind,
  taskId: string,
  workdir: string,
  updatedAt: number,
): WorkspaceState {
  if (state) {
    return {
      ...state,
      lastTaskId: taskId,
      updatedAt,
    };
  }

  return {
    sessionKey,
    mode: taskKind === "dev" ? "dev" : "chat",
    cwd: workdir,
    branch: undefined,
    lastTaskId: taskId,
    lastErrorSummary: undefined,
    updatedAt,
  };
}

function buildTaskRecord(
  taskId: string,
  sessionKey: string,
  taskKind: TaskKind,
  prompt: string,
  createdAt: number,
): TaskRecord {
  return {
    id: taskId,
    sessionKey,
    kind: taskKind,
    title: prompt.slice(0, 60),
    inputText: prompt,
    status: "running",
    createdAt,
    startedAt: createdAt,
    finishedAt: undefined,
    summary: undefined,
    errorSummary: undefined,
  };
}

function isErrorWithMessage(error: unknown): error is Error {
  return error instanceof Error;
}

export function createTaskOrchestrator(deps: TaskOrchestratorDeps) {
  const { logger, config, sessionStore, runtimeStore, codexRunner } = deps;

  return {
    async startTask(params: StartTaskParams): Promise<StartTaskResult> {
      const { sessionKey, chatId, prompt, taskKind, imagePaths } = params;
      const taskId = randomUUID();
      const queuedAt = Date.now();
      const controller = new AbortController();
      taskAbortControllers.set(taskId, controller);

      let eventSeq = 0;
      const appendEvent = (phase: TaskEventPhase, message: string, createdAt: number) => {
        runtimeStore.appendTaskEvent({
          taskId,
          seq: ++eventSeq,
          phase,
          message,
          createdAt,
        });
      };

      const existingState = runtimeStore.getWorkspaceState(sessionKey);
      const workdir = existingState?.cwd ?? config.codexWorkdir;

      runtimeStore.createTask(buildTaskRecord(taskId, sessionKey, taskKind, prompt, queuedAt));
      runtimeStore.saveWorkspaceState(
        resolveWorkspaceState(existingState, sessionKey, taskKind, taskId, workdir, queuedAt),
      );
      appendEvent("queued", "\u4efb\u52a1\u5df2\u5165\u961f", queuedAt);

      sessionStore.appendUser(sessionKey, prompt);
      const history = sessionStore.loadRecent(sessionKey, config.codexHistoryTurns);
      const codexPrompt = buildPrompt({ sessionKey, history });
      const sessionOptions = sessionStore.getSessionOptions(sessionKey);

      try {
        const result = await codexRunner.run({
          sessionKey,
          prompt: codexPrompt,
          workdir,
          timeoutMs: config.codexTimeoutMs,
          model: sessionOptions.model ?? config.codexDefaultModel,
          reasoningEffort: sessionOptions.thinkingLevel ?? config.codexDefaultThinkingLevel,
          imagePaths,
          onEvent: (event) => {
            const progress = mapCodexEventToProgress(event);
            if (!progress) {
              return;
            }
            appendEvent("progress", progress, Date.now());
          },
          abortSignal: controller.signal,
        });

        const parsed = parseAssistantResponse(result.answer, workdir);
        const text = parsed.text || result.answer;
        const finishedAt = Date.now();

        sessionStore.appendAssistant(sessionKey, text);
        runtimeStore.updateTaskStatus(taskId, "completed", {
          finishedAt,
          summary: text,
          errorSummary: undefined,
        });
        appendEvent("result", "\u4efb\u52a1\u5b8c\u6210", finishedAt);
        runtimeStore.replaceTaskArtifacts(taskId, []);

        logger.info({ taskId, sessionKey, chatId, durationMs: result.durationMs }, "task completed");

        return {
          taskId,
          text,
          directives: parsed.directives,
        };
      } catch (error) {
        const finishedAt = Date.now();
        const message = isErrorWithMessage(error) ? error.message : "unknown task error";

        runtimeStore.updateTaskStatus(taskId, "failed", {
          finishedAt,
          errorSummary: message,
        });
        appendEvent("error", message, finishedAt);
        runtimeStore.replaceTaskArtifacts(taskId, []);
        logger.error({ err: error, taskId, sessionKey, chatId }, "task failed");
        throw error;
      } finally {
        taskAbortControllers.delete(taskId);
      }
    },
  };
}
