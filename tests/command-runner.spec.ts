import { describe, expect, it } from "vitest";
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
});
