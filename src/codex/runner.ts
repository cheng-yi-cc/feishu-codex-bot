import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  CodexJsonItem,
  CodexJsonRecord,
  CodexJsonState,
  CodexRunner,
  CodexRunnerOptions,
  CodexStreamListener,
} from "./types.js";
import type { CodexRunRequest, CodexRunResult } from "../types/contracts.js";

type SpawnFactory = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
) => ChildProcessWithoutNullStreams;

const defaultSpawnFactory: SpawnFactory = (file, args, options) =>
  spawn(file, args, options) as unknown as ChildProcessWithoutNullStreams;

function toUsage(eventUsage: unknown): CodexJsonState["usage"] | undefined {
  if (!eventUsage || typeof eventUsage !== "object") {
    return undefined;
  }

  const usage = eventUsage as { input_tokens?: unknown; output_tokens?: unknown };
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
  };
}

function getToolLabel(item: CodexJsonItem | undefined): string {
  const label = item?.description ?? item?.name;
  if (typeof label === "string" && label.trim().length > 0) {
    return label;
  }
  return "tool";
}

export function applyCodexJsonLine(
  line: string,
  state: CodexJsonState,
  onEvent?: CodexStreamListener,
): void {
  if (!line.trim()) return;

  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (!event || typeof event !== "object") return;

  const record = event as CodexJsonRecord;

  if (record.type === "thread.started" && typeof record.thread_id === "string") {
    state.threadId = record.thread_id;
    onEvent?.({ type: "thread.started", threadId: record.thread_id });
    return;
  }

  if (record.item?.type === "tool_call" && record.type === "item.started") {
    const label = getToolLabel(record.item);
    onEvent?.({ type: "tool.started", label, message: label });
    return;
  }

  if (record.item?.type === "tool_call" && record.type === "item.completed") {
    const label = getToolLabel(record.item);
    onEvent?.({ type: "tool.completed", label, message: label });
    return;
  }

  if (record.type === "item.completed" && record.item?.type === "agent_message") {
    if (typeof record.item.text === "string" && record.item.text.trim().length > 0) {
      state.answer = record.item.text;
      onEvent?.({ type: "agent.message", message: record.item.text });
    }
    return;
  }

  if (record.type === "turn.completed") {
    state.usage = toUsage(record.usage);
    onEvent?.({
      type: "turn.completed",
      inputTokens: state.usage?.inputTokens,
      outputTokens: state.usage?.outputTokens,
    });
  }
}

export function createCodexRunner(
  options: CodexRunnerOptions,
  spawnFactory: SpawnFactory = defaultSpawnFactory,
): CodexRunner {
  return {
    async run(request: CodexRunRequest): Promise<CodexRunResult> {
      const startedAt = Date.now();
      const timeoutMs = request.timeoutMs || options.timeoutMs;
      const workdir = request.workdir || options.defaultWorkdir;
      const state: CodexJsonState = {};
      const stderrChunks: string[] = [];

      const args = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-s",
        options.sandboxMode,
        "-C",
        workdir,
      ];

      if (request.model) {
        args.push("-m", request.model);
      }

      if (request.reasoningEffort) {
        args.push("-c", `model_reasoning_effort='${request.reasoningEffort}'`);
      }

      for (const imagePath of request.imagePaths ?? []) {
        args.push("-i", imagePath);
      }

      args.push(request.prompt);

      const child = spawnFactory(options.codexBin, args, {
        cwd: workdir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      await new Promise<void>((resolve, reject) => {
        let stdoutBuffer = "";
        let finished = false;
        let abortHandler: (() => void) | undefined;

        const cleanup = () => {
          if (abortHandler && request.abortSignal) {
            request.abortSignal.removeEventListener("abort", abortHandler);
          }
        };

        const timeout = setTimeout(() => {
          if (!finished) {
            finished = true;
            cleanup();
            child.kill();
            reject(new Error(`codex execution timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        if (request.abortSignal) {
          abortHandler = () => {
            if (finished) {
              return;
            }

            finished = true;
            clearTimeout(timeout);
            cleanup();
            child.kill();
            reject(new Error("codex execution aborted"));
          };

          if (request.abortSignal.aborted) {
            abortHandler();
            return;
          }

          request.abortSignal.addEventListener("abort", abortHandler, { once: true });
        }

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBuffer += chunk.toString("utf8");
          let idx = stdoutBuffer.indexOf("\n");
          while (idx >= 0) {
            const line = stdoutBuffer.slice(0, idx);
            applyCodexJsonLine(line, state, request.onEvent);
            stdoutBuffer = stdoutBuffer.slice(idx + 1);
            idx = stdoutBuffer.indexOf("\n");
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          if (stderrChunks.length < 50) {
            stderrChunks.push(chunk.toString("utf8"));
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          cleanup();
          reject(err);
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          cleanup();
          finished = true;
          if (stdoutBuffer.trim()) {
            applyCodexJsonLine(stdoutBuffer, state, request.onEvent);
          }

          if (code !== 0) {
            const stderrPreview = stderrChunks.join("").slice(0, 1000);
            reject(new Error(`codex exited with code ${code}. stderr: ${stderrPreview}`));
            return;
          }

          resolve();
        });
      });

      if (!state.answer) {
        throw new Error("codex returned no assistant message");
      }

      return {
        answer: state.answer,
        usage: state.usage,
        threadId: state.threadId,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}
