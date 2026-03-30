import { spawn } from "node:child_process";

export function createWorkspaceCommandRunner(options: {
  shell: string;
  maxOutputChars: number;
}) {
  return {
    run(input: { cwd: string; command: string; timeoutMs: number }) {
      return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(options.shell, ["-NoLogo", "-NoProfile", "-Command", input.command], {
          cwd: input.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          callback();
        };

        const timeout = setTimeout(() => {
          child.kill();
          finish(() => reject(new Error(`workspace command timed out after ${input.timeoutMs}ms`)));
        }, input.timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdout = (stdout + chunk.toString("utf8")).slice(-options.maxOutputChars);
        });

        child.stderr.on("data", (chunk: Buffer) => {
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
