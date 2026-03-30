import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/workspace/path-policy.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
  tempPaths.length = 0;
});

describe("resolveWorkspacePath", () => {
  it("allows paths under the workspace root", () => {
    expect(
      resolveWorkspacePath("D:\\My Project", "D:\\My Project\\feishu-codex-bot"),
    ).toBe("D:\\My Project\\feishu-codex-bot");
  });

  it("rejects paths outside the workspace root", () => {
    expect(() => resolveWorkspacePath("D:\\My Project", "C:\\Windows")).toThrow(
      /outside the configured workspace root/i,
    );
  });

  it("rejects paths that escape through a symlink or junction", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-path-root-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-path-outside-"));
    const linkPath = path.join(workspaceRoot, "escape-link");
    tempPaths.push(workspaceRoot, outsideRoot);

    try {
      fs.symlinkSync(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      expect(["EPERM", "EACCES", "UNKNOWN"]).toContain(code);
      return;
    }

    expect(() => resolveWorkspacePath(workspaceRoot, path.join(linkPath, "child"))).toThrow(
      /outside the configured workspace root/i,
    );
  });
});
