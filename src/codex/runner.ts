import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexJsonState, CodexRunner, CodexRunnerOptions } from "./types.js";
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

export function applyCodexJsonLine(line: string, state: CodexJsonState): void {
  if (!line.trim()) return;

  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (!event || typeof event !== "object") return;

  const record = event as {
    type?: string;
    thread_id?: string;
    item?: { type?: string; text?: string };
    usage?: unknown;
  };

  if (record.type === "thread.started" && typeof record.thread_id === "string") {
    state.threadId = record.thread_id;
    return;
  }

  if (record.type === "item.completed" && record.item?.type === "agent_message") {
    if (typeof record.item.text === "string" && record.item.text.trim().length > 0) {
      state.answer = record.item.text;
    }
    return;
  }

  if (record.type === "turn.completed") {
    state.usage = toUsage(record.usage);
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

        const timeout = setTimeout(() => {
          if (!finished) {
            child.kill();
            reject(new Error(`codex execution timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBuffer += chunk.toString("utf8");
          let idx = stdoutBuffer.indexOf("\n");
          while (idx >= 0) {
            const line = stdoutBuffer.slice(0, idx);
            applyCodexJsonLine(line, state);
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
          reject(err);
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          finished = true;
          if (stdoutBuffer.trim()) {
            applyCodexJsonLine(stdoutBuffer, state);
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
