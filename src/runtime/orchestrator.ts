import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { buildPrompt } from "../codex/prompt-builder.js";
import { parseAssistantResponse, type OutgoingDirective } from "../codex/response-parser.js";
import type { CodexRunner } from "../codex/types.js";
import type { BotConfig } from "../types/config.js";
import type { SessionStore } from "../types/contracts.js";
import { createWorkspaceCommandRunner } from "../workspace/command-runner.js";
import { resolveWorkspacePath } from "../workspace/path-policy.js";
import { mapCodexEventToProgress } from "./progress.js";
import type {
  RuntimeStore,
  TaskKind,
  TaskRecord,
  TaskEventPhase,
  WorkspaceCommandName,
  WorkspaceState,
} from "./types.js";

type WorkspaceCommandRunner = ReturnType<typeof createWorkspaceCommandRunner>;

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
  workspaceCommandRunner?: Pick<WorkspaceCommandRunner, "run">;
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
const workspaceCommandAbortControllers = new Map<string, AbortController>();
const defaultWorkspaceCommandRunner = createWorkspaceCommandRunner({
  shell: "powershell.exe",
  maxOutputChars: 4000,
});

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
      cwd: workdir,
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

function isInterruptedError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.toLowerCase().includes("aborted");
}

function buildAssistantHistoryEntry(text: string, directives: OutgoingDirective[]): string | undefined {
  if (text) {
    return text;
  }
  if (directives.length > 0) {
    return `[assistant_sent_attachments]: ${directives.length}`;
  }
  return undefined;
}

function escapePowershellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildLogsCommand(logDir: string): string {
  const logPath = path.join(logDir, "app.log");
  const escapedLogPath = escapePowershellLiteral(logPath);
  return [
    `$logPath = '${escapedLogPath}'`,
    'if (Test-Path -LiteralPath $logPath) {',
    "  Get-Content -LiteralPath $logPath -Tail 80",
    "} else {",
    '  Write-Output "app.log not found: $logPath"',
    "}",
  ].join("; ");
}

function buildBranchCommand(branchName?: string): string {
  if (!branchName) {
    return "git branch --show-current";
  }

  const escapedBranchName = escapePowershellLiteral(branchName);
  return [
    `$branch = '${escapedBranchName}'`,
    "git switch -- $branch 2>$null",
    "if ($LASTEXITCODE -ne 0) { git switch -c -- $branch }",
  ].join("; ");
}

function buildWorkspaceCommandText(
  command: WorkspaceCommandName,
  value: string | undefined,
  workdir: string,
  config: BotConfig,
): string | undefined {
  if (command === "run") {
    return value?.trim();
  }
  if (command === "test") {
    return value?.trim() ? `npm test -- ${value.trim()}` : "npm test";
  }
  if (command === "diff") {
    return "git diff --stat --no-ext-diff";
  }
  if (command === "files") {
    return "git diff --name-only --no-ext-diff";
  }
  if (command === "logs") {
    return buildLogsCommand(config.logDir ?? path.join(config.codexWorkdir, "logs"));
  }
  if (command === "branch") {
    return buildBranchCommand(value?.trim());
  }
  return undefined;
}

export function createTaskOrchestrator(deps: TaskOrchestratorDeps) {
  const { logger, config, sessionStore, runtimeStore, codexRunner } = deps;
  const workspaceCommandRunner = deps.workspaceCommandRunner ?? defaultWorkspaceCommandRunner;

  return {
    async startTask(params: StartTaskParams): Promise<StartTaskResult> {
      const { sessionKey, chatId, prompt, taskKind, imagePaths } = params;
      const taskId = randomUUID();
      const queuedAt = Date.now();
      const controller = new AbortController();
      taskAbortControllers.set(taskId, controller);
      let taskCreated = false;
      let existingState: WorkspaceState | undefined;
      let workdir = resolveWorkspacePath(config.codexWorkdir);

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

      try {
        existingState = runtimeStore.getWorkspaceState(sessionKey);
        workdir = resolveWorkspacePath(config.codexWorkdir, existingState?.cwd ?? config.codexWorkdir);

        runtimeStore.createTask(buildTaskRecord(taskId, sessionKey, taskKind, prompt, queuedAt));
        taskCreated = true;
        runtimeStore.saveWorkspaceState(
          resolveWorkspaceState(existingState, sessionKey, taskKind, taskId, workdir, queuedAt),
        );
        appendEvent("queued", "任务已入队", queuedAt);

        sessionStore.appendUser(sessionKey, prompt);
        const history = sessionStore.loadRecent(sessionKey, config.codexHistoryTurns);
        const codexPrompt = buildPrompt({ sessionKey, history });
        const sessionOptions = sessionStore.getSessionOptions(sessionKey);

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
        const text = parsed.text.trim();
        const historyEntry = buildAssistantHistoryEntry(text, parsed.directives);
        const finishedAt = Date.now();

        if (historyEntry) {
          sessionStore.appendAssistant(sessionKey, historyEntry);
        }
        runtimeStore.updateTaskStatus(taskId, "completed", {
          finishedAt,
          summary: text || undefined,
          errorSummary: undefined,
        });
        runtimeStore.saveWorkspaceState({
          ...resolveWorkspaceState(existingState, sessionKey, taskKind, taskId, workdir, finishedAt),
          lastErrorSummary: undefined,
        });
        appendEvent("result", "任务完成", finishedAt);
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
        const interrupted = isInterruptedError(error, controller.signal);
        const terminalStatus = interrupted ? "interrupted" : "failed";
        const taskErrorSummary = interrupted ? undefined : message;
        const workspaceErrorSummary = interrupted ? undefined : message;

        if (taskCreated) {
          try {
            runtimeStore.updateTaskStatus(taskId, terminalStatus, {
              finishedAt,
              errorSummary: taskErrorSummary,
            });
          } catch (cleanupError) {
            logger.error({ err: cleanupError, taskId }, "failed to update task status during cleanup");
          }

          try {
            appendEvent("error", message, finishedAt);
          } catch (cleanupError) {
            logger.error({ err: cleanupError, taskId }, "failed to append task error event during cleanup");
          }

          try {
            runtimeStore.replaceTaskArtifacts(taskId, []);
          } catch (cleanupError) {
            logger.error({ err: cleanupError, taskId }, "failed to clear task artifacts during cleanup");
          }

          try {
            runtimeStore.saveWorkspaceState({
              ...resolveWorkspaceState(existingState, sessionKey, taskKind, taskId, workdir, finishedAt),
              lastErrorSummary: workspaceErrorSummary,
            });
          } catch (cleanupError) {
            logger.error({ err: cleanupError, taskId }, "failed to persist workspace error summary during cleanup");
          }
        }

        if (interrupted) {
          logger.info({ err: error, taskId, sessionKey, chatId }, "task interrupted");
        } else {
          logger.error({ err: error, taskId, sessionKey, chatId }, "task failed");
        }
        throw error;
      } finally {
        taskAbortControllers.delete(taskId);
      }
    },

    async handleWorkspaceCommand(params: {
      sessionKey: string;
      command: WorkspaceCommandName;
      value?: string;
    }): Promise<{ text: string; directives: OutgoingDirective[] }> {
      const workspace = runtimeStore.getWorkspaceState(params.sessionKey);
      const cwd = resolveWorkspacePath(config.codexWorkdir, workspace?.cwd ?? config.codexWorkdir);

      if (params.command === "abort") {
        const workspaceController = workspaceCommandAbortControllers.get(params.sessionKey);
        if (workspaceController) {
          workspaceController.abort();
          return { text: "已终止当前工作区命令。", directives: [] };
        }

        const taskId = workspace?.lastTaskId;
        if (taskId && taskAbortControllers.has(taskId)) {
          taskAbortControllers.get(taskId)?.abort();
          runtimeStore.updateTaskStatus(taskId, "interrupted", {
            errorSummary: "aborted from Feishu",
            finishedAt: Date.now(),
          });
          return { text: "已终止当前任务。", directives: [] };
        }

        return { text: "当前没有可终止的运行任务。", directives: [] };
      }

      if (params.command === "apply") {
        return {
          text: "/apply 暂未接入自动补丁流程，请在 Codex 会话中直接执行。",
          directives: [],
        };
      }

      const commandText = buildWorkspaceCommandText(params.command, params.value, cwd, config);
      if (!commandText) {
        return {
          text: "请提供要执行的命令。",
          directives: [],
        };
      }

      const controller = new AbortController();
      workspaceCommandAbortControllers.set(params.sessionKey, controller);

      try {
        const result = await workspaceCommandRunner.run({
          cwd,
          command: commandText,
          timeoutMs: config.codexTimeoutMs,
          abortSignal: controller.signal,
        });

        return {
          text: result.exitCode === 0 ? result.stdout || "命令执行完成。" : result.stderr || result.stdout,
          directives: [],
        };
      } finally {
        if (workspaceCommandAbortControllers.get(params.sessionKey) === controller) {
          workspaceCommandAbortControllers.delete(params.sessionKey);
        }
      }
    },
  };
}
