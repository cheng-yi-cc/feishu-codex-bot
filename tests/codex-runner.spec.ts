import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { applyCodexJsonLine, createCodexRunner } from "../src/codex/runner.js";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe("applyCodexJsonLine", () => {
  it("extracts thread, agent message, usage", () => {
    const state: { threadId?: string; answer?: string; usage?: { inputTokens?: number; outputTokens?: number } } = {};

    applyCodexJsonLine('{"type":"thread.started","thread_id":"t1"}', state);
    applyCodexJsonLine(
      '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}',
      state,
    );
    applyCodexJsonLine('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}', state);

    expect(state.threadId).toBe("t1");
    expect(state.answer).toBe("hello");
    expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it("ignores invalid json lines", () => {
    const state: { answer?: string } = {};
    applyCodexJsonLine("not-json", state);
    expect(state.answer).toBeUndefined();
  });
});

describe("createCodexRunner", () => {
  it("returns answer from json stream", async () => {
    const child = createFakeChild();
    const spawnFactory = vi.fn(() => child as any);
    const runner = createCodexRunner(
      {
        codexBin: "codex",
        sandboxMode: "danger-full-access",
        defaultWorkdir: "C:\\tmp",
        timeoutMs: 1000,
      },
      spawnFactory as any,
    );

    setTimeout(() => {
      child.stdout.write('{"type":"thread.started","thread_id":"t1"}\n');
      child.stdout.write(
        '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n',
      );
      child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n');
      child.emit("close", 0);
    }, 10);

    const result = await runner.run({
      sessionKey: "s1",
      prompt: "hello",
      workdir: "C:\\tmp",
      timeoutMs: 1000,
      model: "gpt-5",
      reasoningEffort: "high",
      imagePaths: ["C:\\tmp\\image1.png"],
    });

    expect(result.answer).toBe("ok");
    expect(result.threadId).toBe("t1");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
    expect(spawnFactory).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "-m",
        "gpt-5",
        "-c",
        "model_reasoning_effort='high'",
        "-i",
        "C:\\tmp\\image1.png",
        "hello",
      ]),
      expect.any(Object),
    );
  });

  it("emits tool progress events from json stream", async () => {
    const child = createFakeChild();
    const runner = createCodexRunner(
      {
        codexBin: "codex",
        sandboxMode: "danger-full-access",
        defaultWorkdir: "C:\\tmp",
        timeoutMs: 1000,
      },
      (() => child as any) as any,
    );

    const emitted: string[] = [];

    setTimeout(() => {
      child.stdout.write(
        '{"type":"item.started","item":{"type":"tool_call","description":"Read src/index.ts"}}\n',
      );
      child.stdout.write(
        '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n',
      );
      child.emit("close", 0);
    }, 10);

    await runner.run({
      sessionKey: "s1",
      prompt: "hello",
      workdir: "C:\\tmp",
      timeoutMs: 1000,
      onEvent: (event) => {
        if (event.type === "tool.started") {
          emitted.push(`${event.type}:${event.label}`);
        }
      },
    });

    expect(emitted).toContain("tool.started:Read src/index.ts");
  });

  it("times out when child does not exit", async () => {
    const child = createFakeChild();
    child.kill = vi.fn(() => true);

    const runner = createCodexRunner(
      {
        codexBin: "codex",
        sandboxMode: "danger-full-access",
        defaultWorkdir: "C:\\tmp",
        timeoutMs: 20,
      },
      (() => child as any) as any,
    );

    await expect(
      runner.run({
        sessionKey: "s1",
        prompt: "hello",
        workdir: "C:\\tmp",
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
