import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "../src/workspace/path-policy.js";

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
});
