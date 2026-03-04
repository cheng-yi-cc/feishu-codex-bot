import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseAssistantResponse } from "../src/codex/response-parser.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("parseAssistantResponse", () => {
  it("extracts directives and keeps remaining text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-codex-bot-"));
    tempDirs.push(dir);
    const img = path.join(dir, "a.png");
    const doc = path.join(dir, "b.txt");
    fs.writeFileSync(img, "x");
    fs.writeFileSync(doc, "y");

    const parsed = parseAssistantResponse(
      `已处理\n<send_image path="${img}" />\n<send_file path="${doc}" />`,
      dir,
    );

    expect(parsed.text).toBe("已处理");
    expect(parsed.directives).toEqual([
      { type: "image", path: img },
      { type: "file", path: doc },
    ]);
  });

  it("ignores directives outside workdir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-codex-bot-"));
    tempDirs.push(dir);

    const parsed = parseAssistantResponse(
      '<send_file path="C:\\Windows\\System32\\drivers\\etc\\hosts" />',
      dir,
    );
    expect(parsed.directives).toEqual([]);
  });
});
