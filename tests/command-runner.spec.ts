import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceCommandRunner } from "../src/workspace/command-runner.js";

describe("createWorkspaceCommandRunner", () => {
  it("captures stdout for a safe workspace command", async () => {
    const runner = createWorkspaceCommandRunner({
      shell: "powershell.exe",
      maxOutputChars: 4000,
    });

    const result = await runner.run({
      cwd: process.cwd(),
      command: 'Write-Output "workspace-ok"',
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("workspace-ok");
  });

  it("terminates the process tree when a workspace command times out", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.pid = 4242;
    child.stdout = stdout;
    child.stderr = stderr;

    const terminateProcessTree = vi.fn(async () => {});
    const runner = createWorkspaceCommandRunner({
      shell: "powershell.exe",
      maxOutputChars: 4000,
      spawnImpl: vi.fn(() => child as never),
      terminateProcessTreeImpl: terminateProcessTree,
    });

    await expect(
      runner.run({
        cwd: process.cwd(),
        command: 'Write-Output "slow"',
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/timed out/i);

    expect(terminateProcessTree).toHaveBeenCalledWith(4242);
  });
});
