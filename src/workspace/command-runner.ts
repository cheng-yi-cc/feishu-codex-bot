import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";

export class WorkspaceCommandAbortError extends Error {
  public constructor(message = "workspace command aborted") {
    super(message);
    this.name = "AbortError";
  }
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

async function terminateProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may already be gone, which is acceptable during cleanup.
    }
  }
}

export function createWorkspaceCommandRunner(options: {
  shell: string;
  maxOutputChars: number;
  spawnImpl?: SpawnLike;
  terminateProcessTreeImpl?: (pid: number) => Promise<void>;
}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const terminateProcessTreeImpl = options.terminateProcessTreeImpl ?? terminateProcessTree;

  return {
    run(input: { cwd: string; command: string; timeoutMs: number; abortSignal?: AbortSignal }) {
      return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawnImpl(options.shell, ["-NoLogo", "-NoProfile", "-Command", input.command], {
          cwd: input.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let abortListener: (() => void) | undefined;

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          if (input.abortSignal && abortListener) {
            input.abortSignal.removeEventListener("abort", abortListener);
          }
          callback();
        };

        const terminateAndReject = (error: Error) => {
          if (settled) {
            return;
          }

          void terminateProcessTreeImpl(child.pid ?? -1).finally(() => {
            finish(() => reject(error));
          });
        };

        const timeout = setTimeout(() => {
          terminateAndReject(new Error(`workspace command timed out after ${input.timeoutMs}ms`));
        }, input.timeoutMs);

        if (input.abortSignal) {
          abortListener = () => {
            terminateAndReject(new WorkspaceCommandAbortError());
          };

          if (input.abortSignal.aborted) {
            abortListener();
            return;
          }

          input.abortSignal.addEventListener("abort", abortListener, { once: true });
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout = (stdout + chunk.toString("utf8")).slice(-options.maxOutputChars);
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString("utf8")).slice(-options.maxOutputChars);
        });

        child.on("error", (error) => {
          finish(() => reject(error));
        });

        child.on("close", (code) => {
          finish(() =>
            resolve({
              exitCode: code ?? 1,
              stdout,
              stderr,
            }),
          );
        });
      });
    },
  };
}
